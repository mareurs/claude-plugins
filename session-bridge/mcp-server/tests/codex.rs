#![cfg(unix)] // Unix-only: fakes /proc, unix permissions or process groups
use session_bridge_mcp::{
    codex::{discover_codex, is_thread_id},
    endpoints::Roots,
};
use std::os::unix::fs::symlink;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::TempDir;

const A: &str = "11111111-1111-7111-8111-111111111111";
const B: &str = "22222222-2222-7222-8222-222222222222";
struct Fx {
    dir: TempDir,
}
impl Fx {
    fn new() -> Self {
        let s = Self {
            dir: tempfile::tempdir().unwrap(),
        };
        fs::create_dir(s.p("proc")).unwrap();
        fs::create_dir(s.p("socks")).unwrap();
        s
    }
    fn p(&self, p: &str) -> PathBuf {
        self.dir.path().join(p)
    }
    fn roots(&self) -> Roots {
        Roots {
            proc_root: self.p("proc"),
            socks: self.p("socks"),
        }
    }
    fn process(&self, pid: u32, home: &str) -> PathBuf {
        let config = self.p(home);
        fs::create_dir_all(&config).unwrap();
        let p = self.p(&format!("proc/{pid}"));
        fs::create_dir_all(p.join("fd")).unwrap();
        fs::write(
            p.join("cmdline"),
            b"/usr/bin/codex\0app-server\0--listen\0unix://\0",
        )
        .unwrap();
        fs::write(
            p.join("environ"),
            format!(
                "CODEX_HOME={}\0HOME={}\0",
                config.display(),
                self.dir.path().display()
            ),
        )
        .unwrap();
        let mut fields = vec!["0"; 22];
        fields[0] = "S";
        fields[1] = "1";
        fields[19] = "99";
        fs::write(
            p.join("stat"),
            format!("{pid} (codex) {}", fields.join(" ")),
        )
        .unwrap();
        config
    }
    fn rollout(&self, pid: u32, home: &Path, sid: &str, fd: u32) -> PathBuf {
        let path = home.join(format!("rollout-2026-11-16T10-00-00-{sid}.jsonl"));
        fs::write(
            &path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{sid}\",\"cwd\":\"{}\"}}}}\n",
                self.dir.path().display()
            ),
        )
        .unwrap();
        symlink(&path, self.p(&format!("proc/{pid}/fd/{fd}"))).unwrap();
        path
    }
    fn db(&self, home: &Path, rows: &[(&str, &str, &str, i32)]) {
        let c = rusqlite::Connection::open(home.join("state_5.sqlite")).unwrap();
        c.execute_batch("create table threads(id text,rollout_path text,title text,name text,cwd text,archived integer)").unwrap();
        for (sid, path, name, archived) in rows {
            c.execute(
                "insert into threads values(?1,?2,'fallback title',?3,?4,?5)",
                rusqlite::params![sid, path, name, self.dir.path().to_str(), archived],
            )
            .unwrap();
        }
    }
}
#[test]
fn discovers_threads_not_processes_and_deduplicates_fds() {
    let f = Fx::new();
    let h = f.process(20, "account/.codex");
    let a = f.rollout(20, &h, A, 3);
    f.rollout(20, &h, B, 4);
    symlink(&a, f.p("proc/20/fd/5")).unwrap();
    f.db(&h, &[(A, a.to_str().unwrap(), "first", 0)]);
    let eps = discover_codex(&f.roots());
    assert_eq!(eps.len(), 2);
    let one = eps.iter().find(|e| e.session_id == A).unwrap();
    let two = eps.iter().find(|e| e.session_id == B).unwrap();
    assert_eq!(one.name.as_deref(), Some("first"));
    assert_eq!(one.cwd.as_deref(), Some(f.dir.path()));
    assert_ne!(one.key(), two.key());
    assert_ne!(one.storage_profile(), two.storage_profile());
    assert_eq!(one.key(), format!("codex:{}:{A}", h.display()));
    assert!(one.matches(&format!("codex:.codex:{A}")));
    assert!(one.matches(A));
    assert!(!one.matches("111"));
    assert!(one.revalidate(&f.roots()).is_ok());
    fs::remove_file(f.p("proc/20/fd/3")).unwrap();
    fs::remove_file(f.p("proc/20/fd/5")).unwrap();
    assert!(one.revalidate(&f.roots()).is_err());
}
#[test]
fn distinct_homes_keep_identity_even_with_same_basename_sid_and_pid() {
    let f = Fx::new();
    let h = f.process(20, "left/.codex");
    f.rollout(20, &h, A, 3);
    let h2 = f.process(21, "right/.codex");
    f.rollout(21, &h2, A, 3);
    let eps = discover_codex(&f.roots());
    assert_eq!(eps.len(), 2);
    assert_ne!(eps[0].key(), eps[1].key());
    assert_ne!(eps[0].storage_profile(), eps[1].storage_profile());
    assert!(eps.iter().all(|e| e.matches(A)));
}
#[test]
fn database_alone_is_not_loaded_and_archived_rows_are_skipped() {
    let f = Fx::new();
    let h = f.process(20, ".codex");
    let p = f.rollout(20, &h, A, 3);
    f.db(
        &h,
        &[
            (A, p.to_str().unwrap(), "archived", 1),
            (B, "not-open.jsonl", "saved", 0),
        ],
    );
    assert!(discover_codex(&f.roots()).is_empty());
}
#[test]
fn missing_database_is_never_created_and_rollout_metadata_supplies_cwd() {
    let f = Fx::new();
    let h = f.process(20, ".codex");
    f.rollout(20, &h, A, 3);
    let eps = discover_codex(&f.roots());
    assert_eq!(eps.len(), 1);
    assert_eq!(eps[0].cwd.as_deref(), Some(f.dir.path()));
    assert!(!h.join("state_5.sqlite").exists());
}
#[test]
fn missing_metadata_does_not_invent_cwd_or_name() {
    let f = Fx::new();
    let h = f.process(20, ".codex");
    let p = f.rollout(20, &h, A, 3);
    fs::write(p, "").unwrap();
    let eps = discover_codex(&f.roots());
    assert_eq!(eps.len(), 1);
    assert!(eps[0].cwd.is_none());
    assert!(eps[0].name.is_none());
}
#[test]
fn validates_real_uuid_and_rejects_path_components() {
    assert!(is_thread_id(A));
    for bad in [
        "",
        "../../x",
        "1111",
        "11111111-1111-7111-8111-11111111111z",
        "11111111_1111-7111-8111-111111111111",
    ] {
        assert!(!is_thread_id(bad), "{bad}");
    }
}
#[test]
fn skips_non_host_and_bridge_children_and_dead_proc_entries() {
    let f = Fx::new();
    let h = f.process(20, ".codex");
    f.rollout(20, &h, A, 3);
    fs::write(
        f.p("proc/20/cmdline"),
        b"/tmp/app-server-version/not-codex\0",
    )
    .unwrap();
    assert!(discover_codex(&f.roots()).is_empty());
    fs::write(f.p("proc/20/cmdline"), b"codex\0app-server\0").unwrap();
    fs::write(
        f.p("proc/20/environ"),
        format!("CODEX_HOME={}\0SESSION_BRIDGE_CHILD=1\0", h.display()),
    )
    .unwrap();
    assert!(discover_codex(&f.roots()).is_empty());
}
#[test]
fn defaults_home_from_the_target_process_not_our_environment() {
    let f = Fx::new();
    let h = f.process(20, "user/.codex");
    f.rollout(20, &h, A, 3);
    fs::write(
        f.p("proc/20/environ"),
        format!("HOME={}\0", f.p("user").display()),
    )
    .unwrap();
    assert_eq!(discover_codex(&f.roots())[0].config_dir, h);
}
#[test]
fn process_generation_change_invalidates_snapshot() {
    let f = Fx::new();
    let h = f.process(20, ".codex");
    f.rollout(20, &h, A, 3);
    let e = discover_codex(&f.roots()).remove(0);
    let p = f.p("proc/20/stat");
    let raw = fs::read_to_string(&p).unwrap();
    fs::write(p, raw.replace("99 0", "100 0")).unwrap();
    assert!(e.revalidate(&f.roots()).is_err());
}
#[test]
fn malformed_json_and_schema_do_not_hide_other_profiles() {
    let f = Fx::new();
    let h = f.process(20, "bad/.codex");
    let p = f.rollout(20, &h, A, 3);
    fs::write(p, "{\n").unwrap();
    fs::write(h.join("state_5.sqlite"), "broken").unwrap();
    let h2 = f.process(21, "ok/.codex");
    f.rollout(21, &h2, B, 3);
    assert_eq!(discover_codex(&f.roots()).len(), 2);
}

#[test]
fn locked_metadata_is_bounded_and_falls_back_to_open_rollout_without_writing() {
    let f = Fx::new();
    let home = f.process(20, "account/.codex");
    let rollout = f.rollout(20, &home, A, 3);
    f.db(&home, &[(A, rollout.to_str().unwrap(), "locked name", 0)]);
    let db_path = home.join("state_5.sqlite");
    let before = fs::read(&db_path).unwrap();
    let lock = rusqlite::Connection::open(&db_path).unwrap();
    lock.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let started = std::time::Instant::now();
    let endpoints = discover_codex(&f.roots());
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    assert_eq!(endpoints.len(), 1);
    assert_eq!(endpoints[0].session_id, A);
    assert_eq!(endpoints[0].name, None);
    assert_eq!(endpoints[0].cwd.as_deref(), Some(f.dir.path()));
    lock.execute_batch("ROLLBACK").unwrap();
    assert_eq!(before, fs::read(db_path).unwrap());
}
