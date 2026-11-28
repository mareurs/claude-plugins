//! The few places where Unix and Windows differ: what runs, how a child is detached or killed
//! as a group, which file is the same file, and the process facts the endpoint registry needs.
//! Everything else in the crate is platform-neutral.

use std::path::{Path, PathBuf};

/// Executable extensions a bare program name may carry on Windows.
#[cfg(windows)]
const WINDOWS_EXTS: [&str; 4] = ["exe", "cmd", "bat", "com"];

/// A file the OS can run: the execute bit on Unix, an executable extension on Windows.
pub fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.is_file()
            && p.metadata()
                .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(windows)]
    {
        p.is_file()
            && p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| WINDOWS_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
    }
}

/// The paths a bare program name can take inside `dir`: the name itself on Unix, the name with
/// each executable extension on Windows (`claude` is `claude.exe`).
pub fn program_candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    #[cfg(unix)]
    {
        vec![dir.join(name)]
    }
    #[cfg(windows)]
    {
        let mut out = vec![dir.join(name)];
        out.extend(WINDOWS_EXTS.iter().map(|e| dir.join(format!("{name}.{e}"))));
        out
    }
}

/// First executable `name` in the absolute entries of `path_var` (a relative or empty entry
/// would run a binary from the current directory).
pub fn find_on_path(name: &str, path_var: &str) -> Option<PathBuf> {
    std::env::split_paths(path_var)
        .filter(|d| d.is_absolute())
        .flat_map(|d| program_candidates(&d, name))
        .find(|p| is_executable(p))
}

/// Whether `program` names a path (has a directory part) rather than a bare command.
pub fn has_dir_part(program: &str) -> bool {
    program.contains('/') || (cfg!(windows) && program.contains('\\'))
}

/// Where scratch directories go: `/tmp` on Unix (a fixed location), the user's temp directory
/// on Windows.
pub fn scratch_root() -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from("/tmp")
    }
    #[cfg(windows)]
    {
        std::env::temp_dir()
    }
}

/// Identity of the file behind `m`, stable while it is the same file and different after it is
/// replaced: device and inode on Unix, creation time on Windows (a rotated file is a new file
/// with a new creation time).
pub fn file_identity(m: &std::fs::Metadata) -> (u64, u64) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (m.dev(), m.ino())
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        (m.creation_time(), 0)
    }
}

/// Make `cmd` its own process group, so the whole tree can be killed with [`ProcessGroup`].
pub fn isolate_group(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
}

/// Kills the child's whole process tree when dropped: `killpg` on Unix, a kill-on-close job
/// object on Windows.
pub struct ProcessGroup {
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

impl ProcessGroup {
    pub fn new(pid: u32) -> Self {
        #[cfg(unix)]
        {
            ProcessGroup { pid }
        }
        #[cfg(windows)]
        {
            ProcessGroup {
                job: win::job_for(pid),
            }
        }
    }
}

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use nix::{
                sys::signal::{killpg, Signal},
                unistd::Pid,
            };
            let _ = killpg(Pid::from_raw(self.pid as i32), Signal::SIGKILL);
        }
        #[cfg(windows)]
        win::kill_job(self.job);
    }
}

// SAFETY: the Windows job handle is an opaque kernel handle, usable from any thread.
#[cfg(windows)]
unsafe impl Send for ProcessGroup {}

/// Detach `cmd` from the caller: its own session on Unix (`setsid`, so it survives the hook's
/// process group ending), a detached process outside the caller's job on Windows.
/// Returns the child pid, or the spawn error.
pub fn spawn_detached(cmd: &mut std::process::Command) -> std::io::Result<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: the closure runs in the child between fork and exec, where only
        // async-signal-safe work is allowed. It makes one setsid(2) syscall and turns an errno
        // into an io::Error (no allocation, no lock, no shared state touched), so it is sound.
        // A new session keeps the worker alive when Claude Code ends the hook's process group.
        unsafe {
            cmd.pre_exec(|| {
                nix::unistd::setsid()
                    .map(|_| ())
                    .map_err(std::io::Error::from)
            });
        }
        cmd.spawn().map(|c| c.id())
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let base = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
        // Claude Code may run hooks inside a job that ends with the hook. Breaking away keeps
        // the worker alive, but is refused when the job forbids it: then start without it.
        match cmd.creation_flags(base | CREATE_BREAKAWAY_FROM_JOB).spawn() {
            Ok(c) => Ok(c.id()),
            Err(_) => cmd.creation_flags(base).spawn().map(|c| c.id()),
        }
    }
}

/// Whether process `pid` is running.
#[cfg(windows)]
pub fn process_alive(pid: u32) -> bool {
    win::process_alive(pid)
}

/// Creation time of process `pid` as a Windows FILETIME (100 ns ticks since 1601).
#[cfg(windows)]
pub fn process_creation_filetime(pid: u32) -> Option<u64> {
    win::creation_filetime(pid)
}

/// Parent of process `pid`.
#[cfg(windows)]
pub fn parent_pid(pid: u32) -> Option<u32> {
    win::parent_pid(pid)
}

/// Milliseconds between the FILETIME epoch (1601) and the Unix epoch (1970).
#[cfg(windows)]
pub const FILETIME_UNIX_EPOCH_MS: i64 = 11_644_473_600_000;

#[cfg(windows)]
mod win {
    use std::mem::{size_of, zeroed};
    use std::ptr::null;
    use windows_sys::Win32::Foundation::{
        CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// A handle that closes itself.
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful Win32 call and is closed once.
            unsafe { CloseHandle(self.0) };
        }
    }

    fn open(pid: u32, access: u32) -> Option<Handle> {
        // SAFETY: plain Win32 call; a null return is handled.
        let h = unsafe { OpenProcess(access, 0, pid) };
        (!h.is_null()).then_some(Handle(h))
    }

    pub fn process_alive(pid: u32) -> bool {
        let Some(h) = open(pid, PROCESS_QUERY_LIMITED_INFORMATION) else {
            return false;
        };
        let mut code = 0u32;
        // SAFETY: `h` is a live process handle and `code` a valid out pointer.
        let ok = unsafe { GetExitCodeProcess(h.0, &mut code) };
        ok != 0 && code == STILL_ACTIVE as u32
    }

    pub fn creation_filetime(pid: u32) -> Option<u64> {
        let h = open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
        // SAFETY: zeroed FILETIMEs are valid out buffers for GetProcessTimes.
        let (mut c, mut e, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) =
            unsafe { zeroed() };
        // SAFETY: `h` is a live process handle; the four pointers are valid.
        let ok = unsafe { GetProcessTimes(h.0, &mut c, &mut e, &mut k, &mut u) };
        (ok != 0).then(|| (u64::from(c.dwHighDateTime) << 32) | u64::from(c.dwLowDateTime))
    }

    pub fn parent_pid(pid: u32) -> Option<u32> {
        // SAFETY: plain Win32 call; the invalid handle is handled.
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let snap = Handle(snap);
        // SAFETY: a zeroed PROCESSENTRY32W with dwSize set is the documented input.
        let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        // SAFETY: `snap` is a live snapshot and `entry` is properly sized.
        let mut more = unsafe { Process32FirstW(snap.0, &mut entry) } != 0;
        while more {
            if entry.th32ProcessID == pid {
                return Some(entry.th32ParentProcessID);
            }
            // SAFETY: as above.
            more = unsafe { Process32NextW(snap.0, &mut entry) } != 0;
        }
        None
    }

    /// A job object that kills its processes when closed, holding the process `pid`. A null
    /// handle when any step fails: the child then simply is not killed as a tree.
    pub fn job_for(pid: u32) -> HANDLE {
        // SAFETY: plain Win32 calls; every failure returns the null handle after cleanup.
        unsafe {
            let job = CreateJobObjectW(null(), null());
            if job.is_null() {
                return job;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            let proc = open(pid, PROCESS_SET_QUOTA | PROCESS_TERMINATE);
            let assigned = match (&proc, set) {
                (Some(p), s) if s != 0 => AssignProcessToJobObject(job, p.0) != 0,
                _ => false,
            };
            if !assigned {
                CloseHandle(job);
                return std::ptr::null_mut();
            }
            job
        }
    }

    pub fn kill_job(job: HANDLE) {
        if job.is_null() {
            return;
        }
        // SAFETY: `job` is the handle `job_for` returned, closed exactly once here.
        unsafe {
            TerminateJobObject(job, 1);
            CloseHandle(job);
        }
    }
}
