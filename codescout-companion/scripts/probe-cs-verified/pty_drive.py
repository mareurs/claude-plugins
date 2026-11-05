"""Drive an INTERACTIVE Claude Code session (no -p) through a pty for the cs-verified probe.

Usage (run.sh with PROBE_INTERACTIVE=1 calls it; HOOK_LOG is the run's hook-log.jsonl):
  python3 -I pty_drive.py <home> <config-dir> <token-file> <cli-binary> <work-dir> <run-dir> <cli args...>

The CLI gets an explicit environment: HOME, PATH, CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN (read from the token
file here, never printed), DISABLE_AUTOUPDATER=1 and TERM=xterm-256color. Onboarding and the folder-trust prompt are
pre-accepted in <config-dir>/.claude.json (a fresh directory inside the run dir).

Script: wait for the TUI to go quiet; send prompt 1; wait for the stub tool to have fired (a new hook-log.jsonl row)
and the screen to go quiet; send `/clear`; send prompt 2; wait for a second hook row and quiet; send `/exit`; wait for
the process to end (kill it after 20 s). Everything the CLI wrote to the terminal is saved raw in <run-dir>/pty.log,
a timeline of the steps in <run-dir>/pty-steps.txt.
"""
import fcntl, json, os, pty, select, struct, sys, termios, time

home, cfg, tok, binp, work, run = sys.argv[1:7]
cli_args = sys.argv[7:]
LOG = os.path.join(run, "hook-log.jsonl")
P1 = os.environ.get("PROBE_PROMPT1", "Call the tool mcp__codescout__edit_code exactly once with no arguments. Then reply with the exact text of every block of its result, and say whether you saw any text starting with [cs-verified] anywhere (quote it if so).")
P2 = os.environ.get("PROBE_PROMPT2", "Call the tool mcp__codescout__edit_code exactly once more with no arguments. Then reply with the exact text of every block of its result, and say whether you saw any text starting with [cs-verified] anywhere (quote it if so).")
CLEAR = os.environ.get("PROBE_INTERACTIVE_CLEAR", "1") == "1"

os.makedirs(cfg, exist_ok=True)
with open(os.path.join(cfg, ".claude.json"), "w") as f:
    json.dump({"hasCompletedOnboarding": True, "theme": "dark", "numStartups": 10,
               "projects": {work: {"hasTrustDialogAccepted": True, "allowedTools": [],
                                   "hasCompletedProjectOnboarding": True}}}, f)

env = {"HOME": home, "PATH": "/usr/local/bin:/usr/bin:/bin", "CLAUDE_CONFIG_DIR": cfg,
       "CLAUDE_CODE_OAUTH_TOKEN": open(tok).read().strip(), "DISABLE_AUTOUPDATER": "1", "TERM": "xterm-256color"}
steps = open(os.path.join(run, "pty-steps.txt"), "w")
t0 = time.time()


def note(s):
    steps.write(f"{time.time() - t0:7.1f}s {s}\n"); steps.flush()


pid, fd = pty.fork()
if pid == 0:
    os.chdir(work)
    os.execve(binp, [binp] + cli_args, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 140, 0, 0))
logf = open(os.path.join(run, "pty.log"), "wb")
last = [time.time()]
alive = [True]


def pump(timeout):
    """read whatever the CLI wrote for up to `timeout` seconds"""
    end = time.time() + timeout
    while time.time() < end and alive[0]:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                alive[0] = False
                return
            if not data:
                alive[0] = False
                return
            logf.write(data); logf.flush(); last[0] = time.time()


def quiet(secs, cap):
    end = time.time() + cap
    while alive[0] and time.time() < end:
        pump(0.5)
        if time.time() - last[0] >= secs:
            return True
    return False


def rows():
    try:
        return sum(1 for line in open(LOG) if '"stdin_raw"' in line)
    except OSError:
        return 0


def send(text):
    os.write(fd, text.encode())
    pump(0.3)
    os.write(fd, b"\r")


def wait_rows(n, cap):
    end = time.time() + cap
    while alive[0] and time.time() < end:
        pump(0.5)
        if rows() >= n:
            return True
    return False


note("started; waiting for the TUI to go quiet")
note(f"quiet={quiet(3, 40)}")
note("send prompt 1"); send(P1)
note(f"hook rows>=1: {wait_rows(1, 90)}")
note(f"quiet after reply: {quiet(6, 60)}")
if CLEAR:
    note("send /clear"); send("/clear")
    note(f"quiet after /clear: {quiet(4, 30)}")
note("send prompt 2"); send(P2)
want = 2
note(f"hook rows>={want}: {wait_rows(want, 90)}")
note(f"quiet after reply 2: {quiet(6, 60)}")
note("send /exit"); send("/exit")
end = time.time() + 20
while alive[0] and time.time() < end:
    pump(0.5)
    try:
        done, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        done = pid; status = 0
    if done:
        note(f"exited, status={status}"); alive[0] = False
        break
else:
    note("still alive after /exit: killing")
    try:
        os.kill(pid, 9); os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError):
        pass
note("done")
