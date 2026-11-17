//! Linux discovery of loaded, rollout-backed Codex threads. No daemon is started.
use crate::endpoints::Roots;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CodexEndpoint {
    pub config_dir: PathBuf,
    pub pid: u32,
    pub session_id: String,
    pub transcript_path: PathBuf,
    pub cwd: Option<PathBuf>,
    pub name: Option<String>,
    #[serde(skip)]
    pub generation: Option<String>,
}
impl CodexEndpoint {
    /// A canonical address. Unlike a name or profile basename it includes the full home.
    pub fn key(&self) -> String {
        format!("codex:{}:{}", self.config_dir.display(), self.session_id)
    }
    /// A filesystem-safe thread identity within the existing (profile, PID) store format.
    /// SHA-256 names the canonical home; the UUID keeps sibling threads separate.
    pub fn storage_profile(&self) -> String {
        format!(
            "codex-{:x}-{}",
            Sha256::digest(self.config_dir.as_os_str().as_encoded_bytes()),
            self.session_id
        )
    }
    pub fn match_rank(&self, target: &str) -> Option<u8> {
        if target == self.key() {
            return Some(0);
        }
        let mut query = target;
        if let Some(rest) = target.strip_prefix("codex:") {
            query = rest;
            if let Some((profile, id)) = rest.rsplit_once(':') {
                if profile != self.config_dir.to_string_lossy()
                    && Some(profile) != self.config_dir.file_name().and_then(|s| s.to_str())
                {
                    return None;
                }
                query = id;
            }
        } else if target.contains(':') {
            return None;
        }
        if query == self.session_id || self.name.as_deref() == Some(query) {
            Some(0)
        } else if query.len() >= 4 && self.session_id.starts_with(query) {
            Some(1)
        } else {
            None
        }
    }
    pub fn matches(&self, target: &str) -> bool {
        self.match_rank(target).is_some()
    }
    /// Recheck the exact host generation, home, UUID and open rollout before an effect.
    pub fn revalidate(&self, roots: &Roots) -> anyhow::Result<()> {
        let current = discover_codex(roots).into_iter().find(|e| {
            e.pid == self.pid
                && e.config_dir == self.config_dir
                && e.session_id == self.session_id
                && e.transcript_path == self.transcript_path
                && e.generation == self.generation
        });
        anyhow::ensure!(
            current.is_some(),
            "Codex target is no longer loaded in its original process/home"
        );
        Ok(())
    }
}
pub fn is_thread_id(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
fn read_limited(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= limit).then_some(bytes)
}
fn proc_env(path: &Path) -> Option<HashMap<String, String>> {
    let bytes = read_limited(&path.join("environ"), 1024 * 1024)?;
    Some(
        bytes
            .split(|b| *b == 0)
            .filter_map(|part| {
                let s = std::str::from_utf8(part).ok()?;
                let (k, v) = s.split_once('=')?;
                Some((k.into(), v.into()))
            })
            .collect(),
    )
}
fn proc_generation(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path.join("stat")).ok()?;
    raw.rsplit_once(") ")?
        .1
        .split_whitespace()
        .nth(19)
        .map(str::to_string)
}
fn root_of(env: &HashMap<String, String>) -> Option<PathBuf> {
    let path = env
        .get("CODEX_HOME")
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env.get("HOME")
                .filter(|s| !s.is_empty())
                .map(|h| Path::new(h).join(".codex"))
        })?;
    if !path.is_absolute() {
        return None;
    }
    fs::canonicalize(path).ok()
}
fn rollout_id(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let core = name.strip_prefix("rollout-")?.strip_suffix(".jsonl")?;
    let sid = core.get(core.len().checked_sub(36)?..)?;
    is_thread_id(sid).then(|| sid.to_string())
}
fn transcript_cwd(path: &Path, sid: &str) -> Option<PathBuf> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file.take(65536));
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let record: serde_json::Value = serde_json::from_str(&line).ok()?;
    if record["type"] != "session_meta" || record["payload"]["id"].as_str() != Some(sid) {
        return None;
    }
    let p = PathBuf::from(record["payload"]["cwd"].as_str()?);
    p.is_absolute().then_some(p)
}
struct Metadata {
    id: String,
    name: Option<String>,
    cwd: Option<PathBuf>,
    archived: bool,
}
fn db_open(home: &Path) -> Option<Connection> {
    let conn = Connection::open_with_flags(
        home.join("state_5.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.busy_timeout(Duration::from_millis(50)).ok()?;
    Some(conn)
}
fn metadata(conn: &Connection, path: &Path) -> Option<Metadata> {
    conn.query_row("SELECT id, COALESCE(NULLIF(name,''),NULLIF(title,'')), cwd, archived FROM threads WHERE rollout_path=?1",
        [path.to_str()?],|row| {
            let cwd:Option<String>=row.get(2)?;
            Ok(Metadata {id:row.get(0)?,name:row.get(1)?,cwd:cwd.map(PathBuf::from).filter(|p|p.is_absolute()),archived:row.get::<_,i64>(3)?!=0})
        }).ok()
}
/// Returns only threads whose rollout is actually open by a live host. Missing databases
/// are opened read-only and never created. Unreadable profiles do not hide others.
/// Busy/idle and UI attachment are deliberately not inferred from an open FD.
pub fn discover_codex(roots: &Roots) -> Vec<CodexEndpoint> {
    let Ok(entries) = fs::read_dir(&roots.proc_root) else {
        return vec![];
    };
    let mut out = Vec::new();
    let mut dbs: HashMap<PathBuf, Option<Connection>> = HashMap::new();
    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let path = entry.path();
        let Some(raw) = read_limited(&path.join("cmdline"), 65536) else {
            continue;
        };
        let argv: Vec<&[u8]> = raw.split(|b| *b == 0).collect();
        if !argv.contains(&b"app-server".as_slice()) {
            continue;
        }
        let Some(env) = proc_env(&path) else {
            continue;
        };
        if env.get("SESSION_BRIDGE_CHILD").is_some_and(|s| s == "1") {
            continue;
        }
        let Some(home) = root_of(&env) else {
            continue;
        };
        let conn = dbs.entry(home.clone()).or_insert_with(|| db_open(&home));
        let Ok(fds) = fs::read_dir(path.join("fd")) else {
            continue;
        };
        let mut seen = HashSet::new();
        for fd in fds.flatten() {
            let Ok(transcript) = fs::read_link(fd.path()) else {
                continue;
            };
            let Some(sid) = rollout_id(&transcript) else {
                continue;
            };
            if !transcript.is_absolute() || !seen.insert(transcript.clone()) {
                continue;
            }
            let info = conn.as_ref().and_then(|c| metadata(c, &transcript));
            if info.as_ref().is_some_and(|m| m.archived || m.id != sid) {
                continue;
            }
            let cwd = info
                .as_ref()
                .and_then(|m| m.cwd.clone())
                .or_else(|| transcript_cwd(&transcript, &sid));
            out.push(CodexEndpoint {
                config_dir: home.clone(),
                pid,
                session_id: sid,
                transcript_path: transcript,
                cwd,
                name: info.and_then(|m| m.name),
                generation: proc_generation(&path),
            });
        }
    }
    out.sort_by(|a, b| {
        (&a.config_dir, &a.session_id, a.pid).cmp(&(&b.config_dir, &b.session_id, b.pid))
    });
    out
}
