//! SQLite notice store: post, read after a cursor, retention with recorded gaps.
//! The store never reads the wall clock; callers pass every timestamp.

use crate::error::{BridgeError, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;
use std::time::Duration;

pub const MAX_TITLE: usize = 120;
pub const MAX_BODY: usize = 4000;
pub const MAX_REFS: usize = 20;
pub const RETENTION_MS: i64 = 14 * 24 * 60 * 60 * 1000;
/// A direct message not delivered within this time expires.
pub const DIRECT_TTL_MS: i64 = 24 * 60 * 60 * 1000;
/// Characters of a direct message body (it becomes model context in one hook output).
pub const MAX_DIRECT_BODY: usize = MAX_BODY;
/// Characters of a direct message sender label.
pub const MAX_SENDER: usize = 512;
/// `post_direct` refuses a message for a session that already has this many pending.
pub const MAX_PENDING_DIRECT: usize = 20;
/// `take_direct` delivers at most this many messages per trigger...
pub const MAX_TAKE_DIRECT: usize = 5;
/// ...and at most this many body characters in total; the rest stay pending, oldest first.
pub const MAX_TAKE_DIRECT_CHARS: usize = 16_000;

static NEXT_DIRECT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Manual,
    Commit,
}

impl Origin {
    fn as_str(self) -> &'static str {
        match self {
            Origin::Manual => "manual",
            Origin::Commit => "commit",
        }
    }
    fn parse(s: &str) -> Origin {
        if s == "commit" {
            Origin::Commit
        } else {
            Origin::Manual
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewNotice {
    pub at_ms: i64,
    pub repo: String,
    pub author_profile: String,
    pub author_pid: u32,
    pub author_session: String,
    pub origin: Origin,
    pub patch_id: Option<String>,
    pub title: String,
    pub body: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Notice {
    pub seq: i64,
    pub at_ms: i64,
    pub repo: String,
    pub author_profile: String,
    pub author_pid: u32,
    pub author_session: String,
    pub origin: Origin,
    pub patch_id: Option<String>,
    pub title: String,
    pub body: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Page {
    pub notices: Vec<Notice>,
    pub next_cursor: i64,
    pub gap: Option<(i64, i64)>,
}

/// A direct message to one exact Claude session, before it is stored.
#[derive(Debug, Clone)]
pub struct NewDirect {
    pub at_ms: i64,
    pub target_profile: String,
    pub target_pid: u32,
    pub target_session: String,
    /// The target process's start time at send time (`endpoints::process_start_ms`), so a
    /// reused pid is recognised as the end of the target; `None` when unreadable.
    pub target_start_ms: Option<i64>,
    /// The target's Claude config dir, where its registration `sessions/<pid>.json` lives.
    pub target_config_dir: Option<String>,
    /// The sender's session identity (`Session::identity`).
    pub sender: String,
    pub body: String,
}

/// A stored direct message; `status` is `pending`, `delivered` or `expired`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Direct {
    pub id: String,
    pub at_ms: i64,
    pub expires_ms: i64,
    pub target_profile: String,
    pub target_pid: u32,
    pub target_session: String,
    pub sender: String,
    pub body: String,
    pub status: String,
    pub delivered_ms: Option<i64>,
    pub target_start_ms: Option<i64>,
    pub target_config_dir: Option<String>,
}

const DIRECT_COLS: &str = "id, at_ms, expires_ms, target_profile, target_pid, target_session, sender, body, status, delivered_ms, target_start_ms, target_config_dir";

fn row_to_direct(r: &Row) -> rusqlite::Result<Direct> {
    Ok(Direct {
        id: r.get(0)?,
        at_ms: r.get(1)?,
        expires_ms: r.get(2)?,
        target_profile: r.get(3)?,
        target_pid: r.get(4)?,
        target_session: r.get(5)?,
        sender: r.get(6)?,
        body: r.get(7)?,
        status: r.get(8)?,
        delivered_ms: r.get(9)?,
        target_start_ms: r.get(10)?,
        target_config_dir: r.get(11)?,
    })
}

pub struct Store {
    conn: Connection,
}

const COLS: &str = "seq, at_ms, repo, author_profile, author_pid, author_session, origin, patch_id, title, body, refs";

fn row_to_notice(r: &Row) -> rusqlite::Result<Notice> {
    let refs: String = r.get(10)?;
    let origin: String = r.get(6)?;
    Ok(Notice {
        seq: r.get(0)?,
        at_ms: r.get(1)?,
        repo: r.get(2)?,
        author_profile: r.get(3)?,
        author_pid: r.get(4)?,
        author_session: r.get(5)?,
        origin: Origin::parse(&origin),
        patch_id: r.get(7)?,
        title: r.get(8)?,
        body: r.get(9)?,
        refs: serde_json::from_str(&refs).unwrap_or_default(),
    })
}

fn check(field: &'static str, limit: usize, actual: usize) -> Result<()> {
    if actual > limit {
        return Err(BridgeError::OverLimit {
            field,
            limit,
            actual,
        });
    }
    Ok(())
}

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        // Switching to WAL and creating the schema can report SQLITE_BUSY at once
        // (the busy handler is skipped when it could deadlock) when another
        // connection initialises the same file, so retry for a bounded time.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            match Self::init(&conn) {
                Ok(()) => break,
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::DatabaseBusy
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(e) => return Err(e.into()),
            }
        }
        Ok(Store { conn })
    }

    fn init(conn: &Connection) -> rusqlite::Result<()> {
        let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
        if !mode.eq_ignore_ascii_case("wal") {
            conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0))?;
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notice (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                at_ms INTEGER NOT NULL,
                repo TEXT NOT NULL,
                author_profile TEXT NOT NULL,
                author_pid INTEGER NOT NULL,
                author_session TEXT NOT NULL,
                origin TEXT NOT NULL,
                patch_id TEXT,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                refs TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS notice_repo_seq ON notice(repo, seq);
            CREATE INDEX IF NOT EXISTS notice_repo_patch ON notice(repo, patch_id);
            CREATE TABLE IF NOT EXISTS deletion (
                lo INTEGER NOT NULL,
                hi INTEGER NOT NULL,
                at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS direct_messages (
                id TEXT PRIMARY KEY,
                at_ms INTEGER NOT NULL,
                expires_ms INTEGER NOT NULL,
                target_profile TEXT NOT NULL,
                target_pid INTEGER NOT NULL,
                target_session TEXT NOT NULL,
                sender TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL,
                delivered_ms INTEGER,
                target_start_ms INTEGER,
                target_config_dir TEXT
            );
            CREATE INDEX IF NOT EXISTS direct_target
                ON direct_messages(target_profile, target_pid, target_session, status);
            CREATE INDEX IF NOT EXISTS direct_sender ON direct_messages(sender, at_ms);",
        )?;
        // A direct_messages table from before the target-identity columns gains them. Two
        // connections may race here; the loser's "duplicate column" is the same outcome.
        let cols = conn
            .prepare("PRAGMA table_info(direct_messages)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (col, ty) in [
            ("target_start_ms", "INTEGER"),
            ("target_config_dir", "TEXT"),
        ] {
            if cols.iter().any(|c| c == col) {
                continue;
            }
            match conn.execute_batch(&format!(
                "ALTER TABLE direct_messages ADD COLUMN {col} {ty}"
            )) {
                Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
                    if msg.contains("duplicate column") => {}
                r => r?,
            }
        }
        Ok(())
    }

    /// Validates limits before writing, prunes notices older than 14 days
    /// (measured from the new notice's `at_ms`), then inserts, all in one transaction.
    pub fn post(&self, n: NewNotice) -> Result<i64> {
        let refs = Self::validated_refs(&n)?;
        let tx = self.tx()?;
        prune_in(&tx, n.at_ms - RETENTION_MS)?;
        let seq = insert_in(&tx, &n, &refs)?;
        tx.commit()?;
        Ok(seq)
    }

    /// Like `post`, but inserts only when no notice of the same `repo` and `patch_id` exists:
    /// the check and the insert share ONE immediate transaction, so two writers with the same
    /// patch (twin sessions, a merge seen from two worktrees) cannot both pass the check.
    /// `Ok(None)` when the patch is already announced. Without a `patch_id` it is `post`.
    pub fn post_commit_once(&self, n: NewNotice) -> Result<Option<i64>> {
        let refs = Self::validated_refs(&n)?;
        let tx = self.tx()?;
        prune_in(&tx, n.at_ms - RETENTION_MS)?;
        if let Some(p) = &n.patch_id {
            let found: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM notice WHERE repo = ?1 AND patch_id = ?2 LIMIT 1",
                    params![n.repo, p],
                    |r| r.get(0),
                )
                .optional()?;
            if found.is_some() {
                tx.commit()?;
                return Ok(None);
            }
        }
        let seq = insert_in(&tx, &n, &refs)?;
        tx.commit()?;
        Ok(Some(seq))
    }

    fn validated_refs(n: &NewNotice) -> Result<String> {
        check("title", MAX_TITLE, n.title.chars().count())?;
        check("body", MAX_BODY, n.body.chars().count())?;
        check("refs", MAX_REFS, n.refs.len())?;
        Ok(serde_json::to_string(&n.refs)?)
    }

    /// Highest seq ever assigned (survives pruning); 0 if none.
    pub fn head(&self) -> Result<i64> {
        let v: Option<i64> = self
            .conn
            .query_row(
                "SELECT seq FROM sqlite_sequence WHERE name = 'notice'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v.unwrap_or(0))
    }

    /// `gap` is the smallest (lo, hi) covering every recorded deletion range that
    /// intersects the window; a non-contiguous prune makes it an over-approximation.
    pub fn after(&self, repo: &str, after: i64, exclude: (&str, u32)) -> Result<Page> {
        // One read transaction: notices, head and gap come from a single snapshot,
        // so next_cursor never covers a seq that `notices` did not see.
        let tx = self.conn.unchecked_transaction()?;
        let mut stmt = tx.prepare(&format!(
            "SELECT {COLS} FROM notice
             WHERE repo = ?1 AND seq > ?2 AND NOT (author_profile = ?3 AND author_pid = ?4)
             ORDER BY seq ASC"
        ))?;
        let notices = stmt
            .query_map(params![repo, after, exclude.0, exclude.1], row_to_notice)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        let head: Option<i64> = tx
            .query_row(
                "SELECT seq FROM sqlite_sequence WHERE name = 'notice'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let next_cursor = after.max(head.unwrap_or(0));
        let gap: (Option<i64>, Option<i64>) = tx.query_row(
            "SELECT MIN(lo), MAX(hi) FROM deletion WHERE hi > ?1 AND lo <= ?2",
            params![after, next_cursor],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        tx.commit()?;
        let gap = match gap {
            (Some(lo), Some(hi)) => Some((lo, hi)),
            _ => None,
        };
        Ok(Page {
            notices,
            next_cursor,
            gap,
        })
    }

    /// Notices of `repo` with `at_ms >= since_ms`, newest first, at most `limit`.
    pub fn recent(
        &self,
        repo: &str,
        since_ms: i64,
        limit: usize,
        exclude: (&str, u32),
    ) -> Result<Vec<Notice>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLS} FROM notice
             WHERE repo = ?1 AND at_ms >= ?2 AND NOT (author_profile = ?3 AND author_pid = ?4)
             ORDER BY at_ms DESC, seq DESC LIMIT ?5"
        ))?;
        let rows = stmt
            .query_map(
                params![repo, since_ms, exclude.0, exclude.1, limit as i64],
                row_to_notice,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
    /// The notices with these seqs, oldest first. A seq that no longer exists (retention
    /// deleted it) is simply absent from the result.
    pub fn get_many(&self, seqs: &[i64]) -> Result<Vec<Notice>> {
        if seqs.is_empty() {
            return Ok(vec![]);
        }
        let marks = vec!["?"; seqs.len()].join(",");
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLS} FROM notice WHERE seq IN ({marks}) ORDER BY seq ASC"
        ))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(seqs.iter()), row_to_notice)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Deletes notices with `at_ms < older_than_ms`; records one (lo, hi) deletion row.
    pub fn prune(&self, older_than_ms: i64) -> Result<usize> {
        let tx = self.tx()?;
        let n = prune_in(&tx, older_than_ms)?;
        tx.commit()?;
        Ok(n)
    }

    /// Stores a pending direct message for one exact Claude session and returns its id. The
    /// body must hold 1..=`MAX_DIRECT_BODY` characters (not only whitespace) and no NUL; the
    /// sender 1..=`MAX_SENDER`. It expires `DIRECT_TTL_MS` after `at_ms`. Messages older
    /// than `RETENTION_MS` are deleted in the same transaction. Refused when the target
    /// session already has `MAX_PENDING_DIRECT` pending, unexpired messages.
    pub fn post_direct(&self, m: NewDirect) -> Result<String> {
        if m.body.trim().is_empty() || m.body.contains('\0') {
            return Err(BridgeError::Invalid(
                "message must contain non-whitespace text and no NUL",
            ));
        }
        check("message", MAX_DIRECT_BODY, m.body.chars().count())?;
        if m.sender.is_empty() {
            return Err(BridgeError::Invalid("sender is empty"));
        }
        check("sender", MAX_SENDER, m.sender.chars().count())?;
        let id = format!(
            "dm-{}-{}-{}",
            m.at_ms,
            std::process::id(),
            NEXT_DIRECT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        let tx = self.tx()?;
        tx.execute(
            "DELETE FROM direct_messages WHERE at_ms < ?1",
            params![m.at_ms - RETENTION_MS],
        )?;
        let pending: i64 = tx.query_row(
            "SELECT COUNT(*) FROM direct_messages WHERE target_profile = ?1 AND target_pid = ?2
                AND target_session = ?3 AND status = 'pending' AND expires_ms > ?4",
            params![m.target_profile, m.target_pid, m.target_session, m.at_ms],
            |r| r.get(0),
        )?;
        if usize::try_from(pending).unwrap_or(usize::MAX) >= MAX_PENDING_DIRECT {
            return Err(BridgeError::TooManyPending(MAX_PENDING_DIRECT));
        }
        tx.execute(
            "INSERT INTO direct_messages (id, at_ms, expires_ms, target_profile, target_pid,
                target_session, sender, body, status, delivered_ms, target_start_ms,
                target_config_dir)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', NULL, ?9, ?10)",
            params![
                id,
                m.at_ms,
                m.at_ms + DIRECT_TTL_MS,
                m.target_profile,
                m.target_pid,
                m.target_session,
                m.sender,
                m.body,
                m.target_start_ms,
                m.target_config_dir
            ],
        )?;
        tx.commit()?;
        Ok(id)
    }

    /// The oldest pending, unexpired direct messages of `target` = (profile, pid, session id),
    /// at most `MAX_TAKE_DIRECT` of them and at most `MAX_TAKE_DIRECT_CHARS` body characters
    /// in total (the rest stay pending for the next trigger), oldest first, marked
    /// `delivered` at `now_ms` in the same transaction: each is
    /// returned at most once (only a row this call's UPDATE actually moved from `pending` is
    /// returned, so that holds even without the immediate write lock). A plain read first
    /// keeps the common empty case free of the write lock (this runs on every tool call).
    pub fn take_direct(&self, target: (&str, u32, &str), now_ms: i64) -> Result<Vec<Direct>> {
        const WHERE: &str = "WHERE target_profile = ?1 AND target_pid = ?2 AND target_session = ?3
             AND status = 'pending' AND expires_ms > ?4";
        let any: Option<i64> = self
            .conn
            .query_row(
                &format!("SELECT 1 FROM direct_messages {WHERE} LIMIT 1"),
                params![target.0, target.1, target.2, now_ms],
                |r| r.get(0),
            )
            .optional()?;
        if any.is_none() {
            return Ok(vec![]);
        }
        let tx = self.tx()?;
        let mut stmt = tx.prepare(&format!(
            "SELECT {DIRECT_COLS} FROM direct_messages {WHERE} ORDER BY at_ms ASC, id ASC LIMIT ?5"
        ))?;
        let rows = stmt
            .query_map(
                params![target.0, target.1, target.2, now_ms, MAX_TAKE_DIRECT as i64],
                row_to_direct,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        let mut taken = Vec::with_capacity(rows.len());
        let mut chars = 0;
        for mut d in rows {
            // Oldest first and in order: stop at the first message over the budget (one
            // message, at most MAX_DIRECT_BODY characters, always fits).
            chars += d.body.chars().count();
            if chars > MAX_TAKE_DIRECT_CHARS {
                break;
            }
            let moved = tx.execute(
                "UPDATE direct_messages SET status = 'delivered', delivered_ms = ?2
                 WHERE id = ?1 AND status = 'pending'",
                params![d.id, now_ms],
            )?;
            if moved == 1 {
                d.status = "delivered".into();
                d.delivered_ms = Some(now_ms);
                taken.push(d);
            }
        }
        tx.commit()?;
        Ok(taken)
    }

    /// Marks `expired` every pending direct message whose time is up at `now_ms` (always) or
    /// whose target `ended` says has ended. `ended` must answer true only on positive
    /// evidence: an unknown or unreadable target counts as live. Returns how many were marked.
    pub fn expire_direct(&self, now_ms: i64, ended: &dyn Fn(&Direct) -> bool) -> Result<usize> {
        // A plain read first, as in `take_direct`: nothing pending takes no write lock.
        let any: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM direct_messages WHERE status = 'pending' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if any.is_none() {
            return Ok(0);
        }
        let tx = self.tx()?;
        let mut stmt = tx.prepare(&format!(
            "SELECT {DIRECT_COLS} FROM direct_messages WHERE status = 'pending'"
        ))?;
        let rows = stmt
            .query_map([], row_to_direct)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        let mut n = 0;
        for d in rows {
            if d.expires_ms <= now_ms || ended(&d) {
                n += tx.execute(
                    "UPDATE direct_messages SET status = 'expired'
                     WHERE id = ?1 AND status = 'pending'",
                    params![d.id],
                )?;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    /// The direct messages `sender` stored at or after `since_ms`, newest first.
    pub fn sent_by(&self, sender: &str, since_ms: i64) -> Result<Vec<Direct>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {DIRECT_COLS} FROM direct_messages WHERE sender = ?1 AND at_ms >= ?2
             ORDER BY at_ms DESC, id DESC"
        ))?;
        let rows = stmt
            .query_map(params![sender, since_ms], row_to_direct)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    fn tx(&self) -> Result<rusqlite::Transaction<'_>> {
        // IMMEDIATE takes the write lock up front, so busy_timeout applies and
        // concurrent writers queue instead of failing on lock upgrade.
        Ok(rusqlite::Transaction::new_unchecked(
            &self.conn,
            rusqlite::TransactionBehavior::Immediate,
        )?)
    }
}

fn insert_in(tx: &rusqlite::Transaction, n: &NewNotice, refs: &str) -> Result<i64> {
    tx.execute(
        "INSERT INTO notice (at_ms, repo, author_profile, author_pid, author_session, origin, patch_id, title, body, refs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            n.at_ms,
            n.repo,
            n.author_profile,
            n.author_pid,
            n.author_session,
            n.origin.as_str(),
            n.patch_id,
            n.title,
            n.body,
            refs
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

fn prune_in(tx: &rusqlite::Transaction, older_than_ms: i64) -> Result<usize> {
    let (lo, hi): (Option<i64>, Option<i64>) = tx.query_row(
        "SELECT MIN(seq), MAX(seq) FROM notice WHERE at_ms < ?1",
        params![older_than_ms],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (Some(lo), Some(hi)) = (lo, hi) else {
        return Ok(0);
    };
    let n = tx.execute(
        "DELETE FROM notice WHERE at_ms < ?1",
        params![older_than_ms],
    )?;
    tx.execute(
        "INSERT INTO deletion (lo, hi, at_ms) VALUES (?1, ?2, ?3)",
        params![lo, hi, older_than_ms],
    )?;
    Ok(n)
}
