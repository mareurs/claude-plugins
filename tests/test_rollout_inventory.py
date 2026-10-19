import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "codescout-companion/scripts/rollout-inventory.py"


class InventoryTests(unittest.TestCase):
    def setUp(self):
        isolated_env = patch.dict(os.environ)
        isolated_env.start()
        self.addCleanup(isolated_env.stop)
        for key in ("CODEX_HOME", "CLAUDE_CONFIG_DIR"):
            os.environ.pop(key, None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / "home"
        self.proc = Path(self.tmp.name) / "proc"
        self.home.mkdir()
        self.proc.mkdir()
        spec = importlib.util.spec_from_file_location("rollout_inventory", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def write(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def collect(self, projects=(), launchers=()):
        return self.module.collect(self.home, self.proc, list(projects), list(launchers), False)

    def test_fifo_launcher_is_refused_without_blocking(self):
        fifo = self.home / "codescout-pipe"
        os.mkfifo(fifo)
        try:
            p = subprocess.run([sys.executable, "-B", str(SCRIPT), "--home", str(self.home),
                                "--proc-root", str(self.proc), "--skip-runtime", "--launcher", str(fifo)],
                               capture_output=True, text=True, timeout=2)
        except subprocess.TimeoutExpired:
            self.fail("diagnostic blocked opening a FIFO launcher")
        self.assertEqual(p.returncode, 0)
        row = json.loads(p.stdout)["launcher_files"][0]
        self.assertEqual(row["read_status"], "not_regular")

    def test_launcher_symlink_to_topic_or_database_is_not_read_or_hashed(self):
        for suffix in [".md", ".sqlite"]:
            data = self.write(self.home / ("private" + suffix), "PRIVATE_DATA")
            wrapper = self.home / ("codescout-wrapper" + suffix + ".sh")
            wrapper.symlink_to(data)
            report = self.collect(launchers=[wrapper])
            row = report["launcher_files"][0]
            self.assertEqual(row["read_status"], "refused_data_file")
            self.assertNotIn("sha256", row["fingerprint"])

    def test_unreadable_launcher_directory_does_not_abort_report(self):
        root = self.home / ".local/bin"
        root.mkdir(parents=True)
        original = Path.iterdir
        def unreadable(path):
            if path == root:
                raise PermissionError("PRIVATE_ERROR")
            return original(path)
        with patch.object(Path, "iterdir", unreadable):
            report = self.collect()
        self.assertFalse(report["inventory_complete"])
        self.assertTrue(any(x["status"] == "unavailable" for x in report["launcher_scopes"]))
        self.assertNotIn("PRIVATE_ERROR", json.dumps(report))


    def test_project_argument_and_configured_wrapper_are_preserved_without_execution(self):
        wrapper = self.write(self.home / "generic-bridge.sh", "exec /old/bin/codescout --token PRIVATE_ARGUMENT\n")
        target = str(self.home / "target")
        self.write(self.home / ".mcp.json", json.dumps({"mcpServers":{"codescout":{
            "command":str(wrapper), "args":["--project", target, "--token", "PRIVATE_ARGUMENT"]}}}))
        report = self.collect()
        self.assertEqual(report["launchers"][0]["argument_paths"]["--project"]["path"], target)
        self.assertTrue(any(x["path"] == str(wrapper) for x in report["launcher_files"]))
        self.assertNotIn("PRIVATE_ARGUMENT", json.dumps(report))

    def test_project_scoped_claude_configuration_keeps_its_project_identity(self):
        roots = [str(self.home / "project-a"), str(self.home / "project-b")]
        self.write(self.home / ".claude.json", json.dumps({"projects":{
            root: {"mcpServers":{"codescout":{"command":"codescout"}}} for root in roots}}))
        report = self.collect()
        self.assertEqual({x["project_scope"]["path"] for x in report["launchers"]}, set(roots))


    def test_non_list_arguments_are_unresolved_without_aborting(self):
        self.write(self.home / ".mcp.json", json.dumps({"mcpServers":{"codescout":{
            "command":"codescout", "args":42, "env":[]}}}))
        report = self.collect()
        self.assertIsNone(report["launchers"][0]["argument_count"])
        self.assertEqual(report["launchers"][0]["argument_paths"], {})


    def test_claude_profile_dot_config_and_explicit_root_are_scanned(self):
        profiles = [".claude", ".claude-sdd", ".claude-kat", "custom-claude"]
        for profile in profiles:
            self.write(self.home / profile / ".claude.json", json.dumps({"mcpServers":{
                "codescout": {"command":"codescout","env":{"LIBRARIAN_DB":"/profile/catalog.sqlite"}}}}))
        with patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.home / "custom-claude")}):
            report = self.collect()
        configs = {x["config"] for x in report["launchers"]}
        self.assertTrue(all(str(self.home / p / ".claude.json") in configs for p in profiles))

    def test_pid_reuse_is_rejected_but_counter_changes_keep_the_process(self):
        pid = self.proc / "42"
        self.write(pid / "status", f"Uid:\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\n")
        self.write(pid / "stat", "42 (codescout) S 1 " + " ".join(["0"] * 17 + ["12345", "0"]))
        self.write(pid / "cmdline", "/old/bin/codescout\0")
        self.write(pid / "environ", "LIBRARIAN_DB=/runtime/catalog.sqlite\0")
        self.write(pid / "cgroup", "")
        binary = self.write(self.home / "codescout", "binary")
        (pid / "exe").symlink_to(binary)
        (pid / "cwd").symlink_to(self.home)
        original = self.module.read_bytes
        for changed_identity in [False, True]:
            calls = []
            def reader(path, limit=self.module.FILE_LIMIT):
                data, status = original(path, limit)
                if path == pid / "stat":
                    calls.append(path)
                    if len(calls) == 2:
                        fields = data.rpartition(b")")[2].split()
                        fields[19 if changed_identity else 11] = b"99999"
                        data = data.rpartition(b")")[0] + b") " + b" ".join(fields)
                return data, status
            with patch.object(self.module, "read_bytes", reader):
                report = self.collect()
            self.assertEqual(len(calls), 2)
            rows = report["process_scan"]["processes"]
            self.assertEqual(len(rows), 0 if changed_identity else 1)
            self.assertEqual(report["process_scan"]["unavailable"], 1 if changed_identity else 0)


    def test_explicit_generic_wrapper_running_process_is_a_candidate(self):
        wrapper = self.write(self.home / "generic-bridge.py", "# launcher\n")
        pid = self.proc / "52"
        self.write(pid / "status", f"Uid:\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\n")
        self.write(pid / "stat", "52 (python) S 1 " + " ".join(["0"] * 17 + ["12345", "0"]))
        self.write(pid / "cmdline", f"/usr/bin/python3\0{wrapper}\0")
        self.write(pid / "environ", "")
        self.write(pid / "cgroup", "")
        binary = self.write(self.home / "python3", "binary")
        (pid / "exe").symlink_to(binary)
        (pid / "cwd").symlink_to(self.home)
        rows = self.collect(launchers=[wrapper])["process_scan"]["processes"]
        self.assertEqual([row["pid"] for row in rows], [52])


    def test_process_identity_is_checked_after_binary_hashing(self):
        pid = self.proc / "42"
        self.write(pid / "status", f"Uid:\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\n")
        stat_path = self.write(pid / "stat", "42 (codescout) S 1 " + " ".join(["0"] * 17 + ["12345", "0"]))
        self.write(pid / "cmdline", "/old/bin/codescout\0")
        self.write(pid / "environ", "")
        self.write(pid / "cgroup", "")
        binary = self.write(self.home / "codescout", "binary")
        (pid / "exe").symlink_to(binary)
        (pid / "cwd").symlink_to(self.home)
        original = self.module.fingerprint
        def changing_process(path, cache):
            result = original(path, cache)
            if path == pid / "exe":
                stat_path.write_text(stat_path.read_text().replace("12345", "99999"))
            return result
        with patch.object(self.module, "fingerprint", changing_process):
            report = self.collect()
        self.assertEqual(report["process_scan"]["processes"], [])
        self.assertEqual(report["process_scan"]["unavailable"], 1)


    def test_empty_inventory_never_authorizes_activation(self):
        report = self.collect()
        self.assertFalse(report["activation_ready"])
        self.assertFalse(report["execution_authorized"])
        self.assertFalse(report["inventory_complete"])
        self.assertEqual(report["process_scan"]["status"], "ok")
        self.assertEqual(report["controllers"]["runtime"]["status"], "not_requested")

    def test_all_case_sensitive_codex_profiles_and_storage_binding_are_reported(self):
        for profile in [".codex", ".Codex", ".Codex-sdd", ".Codex-kat"]:
            self.write(self.home / profile / "config.toml",
                       '[mcp_servers.codescout]\ncommand = "codescout"\n[mcp_servers.codescout.env]\nLIBRARIAN_DB = "/catalog/db.sqlite"\nOPENAI_API_KEY = "DO_NOT_EMIT_TOKEN"\n')
        report = self.collect()
        launchers = [x for x in report["launchers"] if x.get("server") == "codescout"]
        self.assertEqual(len(launchers), 4)
        self.assertTrue(all(x["storage"]["LIBRARIAN_DB"]["path"] == "/catalog/db.sqlite" for x in launchers))
        self.assertNotIn("DO_NOT_EMIT_TOKEN", json.dumps(report))

    def test_config_symlinks_malformed_json_and_arguments_do_not_leak_secrets(self):
        target = self.write(self.home / "settings-real.json", json.dumps({"mcpServers": {
            "codescout": {"command": "/old/bin/codescout", "args": ["--token", "ARG_SECRET"],
                         "env": {"EMBED_API_KEY": "ENV_SECRET", "CODESCOUT_SQLITE_DIR": "/data"}}}}))
        (self.home / ".mcp.json").symlink_to(target)
        self.write(self.home / ".claude.json", '{"password": "PARSE_SECRET", BAD}')
        report = self.collect()
        encoded = json.dumps(report)
        for secret in ["ARG_SECRET", "ENV_SECRET", "PARSE_SECRET"]:
            self.assertNotIn(secret, encoded)
        self.assertTrue(any(x.get("command", {}).get("path") == "/old/bin/codescout" for x in report["launchers"]))
        self.assertTrue(any(x["status"] == "invalid" for x in report["config_files"]))

    def test_process_parent_start_identity_deleted_binary_and_bindings(self):
        pid = self.proc / "42"
        self.write(pid / "status", f"Name:\tcodescout\nUid:\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\t{os.getuid()}\n")
        self.write(pid / "stat", "42 (codescout strange) S 1 " + " ".join(["0"] * 17 + ["12345", "0"]))
        self.write(pid / "cmdline", "/old/bin/codescout\0--token\0PROCESS_SECRET\0")
        self.write(pid / "environ", "LIBRARIAN_DB=/runtime/catalog.sqlite\0OPENAI_API_KEY=PROCESS_ENV_SECRET\0")
        self.write(pid / "cgroup", "0::/user.slice/codescout-bridge.service\n")
        binary = self.write(self.home / "codescout (deleted)", "binary")
        (pid / "exe").symlink_to(binary)
        (pid / "cwd").symlink_to(self.home)
        report = self.collect()
        row = report["process_scan"]["processes"][0]
        self.assertEqual((row["pid"], row["ppid"], row["start_time_ticks"]), (42, 1, "12345"))
        self.assertTrue(row["detached_candidate"])
        self.assertTrue(row["deleted_executable"])
        self.assertEqual(row["storage"]["LIBRARIAN_DB"]["path"], "/runtime/catalog.sqlite")
        self.assertIn("codescout-bridge.service", row["units"])
        self.assertNotIn("PROCESS_SECRET", json.dumps(report))
        self.assertNotIn("PROCESS_ENV_SECRET", json.dumps(report))

    def test_controller_files_and_explicit_wrapper_are_inventory_only(self):
        wrapper = self.write(self.home / "bridge", '#!/bin/sh\nexport LIBRARIAN_DB=/bridge/catalog.sqlite\nexec /old/bin/codescout --key WRAPPER_SECRET\n')
        unit = self.write(self.home / ".config/systemd/user/telegram.service",
                          f"[Service]\nExecStart={wrapper}\nRestart=always\nEnvironment=OPENAI_API_KEY=UNIT_SECRET\n")
        cron = self.write(self.home / ".config/autostart/bridge.desktop", f"[Desktop Entry]\nExec={wrapper}\n")
        report = self.collect(launchers=[wrapper])
        files = report["controllers"]["files"]
        self.assertTrue(any(x["path"] == str(unit) for x in files))
        self.assertTrue(any(x["path"] == str(cron) for x in files))
        self.assertNotIn("WRAPPER_SECRET", json.dumps(report))
        self.assertNotIn("UNIT_SECRET", json.dumps(report))
        self.assertEqual(wrapper.read_text().splitlines()[0], "#!/bin/sh")

    def test_project_stores_are_candidates_without_reading_topic_or_sqlite_contents(self):
        project = Path(self.tmp.name) / "project"
        topic = self.write(project / ".codescout/memories/topic.md", "MEMORY_SECRET")
        db = self.write(project / ".codescout/private-memories/semantic.sqlite", "DB_SECRET")
        self.write(project / ".codescout/projects/member/memories/other.md", "NESTED_SECRET")
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in [topic, db]}
        report = self.collect(projects=[project])
        self.assertEqual(len(report["store_candidates"]), 3)
        for secret in ["MEMORY_SECRET", "DB_SECRET", "NESTED_SECRET"]:
            self.assertNotIn(secret, json.dumps(report))
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in [topic, db]})

    def test_runtime_probes_use_only_fixed_read_commands_and_never_echo_stderr(self):
        calls = []
        def runner(argv, **kwargs):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 1, "", "SUBPROCESS_SECRET")
        with patch.object(self.module.subprocess, "run", runner):
            report = self.module.collect(self.home, self.proc, [], [], True)
        self.assertTrue(calls)
        self.assertTrue(all(argv[0] in ["/usr/bin/systemctl", "/usr/bin/crontab"] for argv in calls))
        self.assertNotIn("SUBPROCESS_SECRET", json.dumps(report))
        self.assertFalse(report["activation_ready"])

    def test_missing_proc_and_unresolved_relative_bindings_are_explicit(self):
        self.write(self.home / ".mcp.json", json.dumps({"mcpServers":{"codescout":{
            "command":"codescout","env":{"LIBRARIAN_DB":"RELATIVE_SECRET"}}}}))
        report = self.module.collect(self.home, self.proc / "absent", [], [], False)
        self.assertEqual(report["process_scan"]["status"], "unavailable")
        self.assertNotIn("RELATIVE_SECRET", json.dumps(report))
        self.assertEqual(report["launchers"][0]["storage"]["LIBRARIAN_DB"]["status"], "unresolved")


if __name__ == "__main__":
    unittest.main()
