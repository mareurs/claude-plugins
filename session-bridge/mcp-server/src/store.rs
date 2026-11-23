//! SQLite notice store: post, read after a cursor, retention with recorded gaps.
//! The store never reads the wall clock; callers pass every timestamp.

use crate::error::{BridgeError, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;
use std::time::Duration;

/// The limits the tool schema teaches. An agent that writes within them is never refused.
pub const MAX_TITLE: usize = 120;
pub const MAX_BODY: usize = 4000;
pub const MAX_REFS: usize = 20;
/// A notice may exceed an advised length by this many percent before it is refused. The
/// tolerance is a net, not a promise: a title of 130 characters is not worth a retry, so the
/// result says what was accepted and the schema still teaches the advised limit.
pub const TOLERANCE_PERCENT: usize = 20;
/// The most characters a title may have (the advised limit plus the tolerance).
pub const HARD_TITLE: usize = MAX_TITLE + MAX_TITLE * TOLERANCE_PERCENT / 100;
/// The most characters a body may have (the advised limit plus the tolerance).
pub const HARD_BODY: usize = MAX_BODY + MAX_BODY * TOLERANCE_PERCENT / 100;
pub const RETENTION_MS: i64 = 14 * 24 * 60 * 60 * 1000;

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
    pub to_session: Option<String>,
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
    pub to_session: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Page {
    pub notices: Vec<Notice>,
    pub next_cursor: i64,
    pub gap: Option<(i64, i64)>,
}

pub struct Store {
    conn: Connection,
}

const COLS: &str = "seq, at_ms, repo, author_profile, author_pid, author_session, origin, patch_id, title, body, refs, to_session";

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
        to_session: r.get(11)?,
    })
}

/// Refuse `actual` above `hard`, and say how much to cut. `advised` is named only when it
/// differs from `hard`, so a count with no tolerance (refs) does not mention a second limit.
fn check(
    field: &'static str,
    unit: &str,
    advised: usize,
    hard: usize,
    actual: usize,
) -> Result<()> {
    if actual > hard {
        let advice = if advised == hard {
            String::new()
        } else {
            format!(" (advised {advised})")
        };
        return Err(BridgeError::OverLimit {
            field,
            message: format!(
                "{field} has {actual} {unit}; at most {hard} are accepted{advice}. Cut at least {}.",
                actual - hard
            ),
        });
    }
    Ok(())
}

/// One line for the tool result when a title or body went over its advised length but inside
/// the tolerance, so the sender learns the limit without a refusal. `None` when both fit.
pub fn advised_note(title: &str, body: &str) -> Option<String> {
    let mut over: Vec<String> = Vec::new();
    let t = title.chars().count();
    if t > MAX_TITLE {
        over.push(format!("title has {t} characters (advised {MAX_TITLE})"));
    }
    let b = body.chars().count();
    if b > MAX_BODY {
        over.push(format!("body has {b} characters (advised {MAX_BODY})"));
    }
    if over.is_empty() {
        None
    } else {
        Some(format!(
            "Accepted whole, but the {}.",
            over.join(" and the ")
        ))
    }
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
            );",
        )?;
        Self::add_to_session(conn)
    }

    /// Adds `to_session` to a database written before addressed notices existed, and its index.
    fn add_to_session(conn: &Connection) -> rusqlite::Result<()> {
        let present: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('notice') WHERE name = 'to_session'",
            [],
            |r| r.get(0),
        )?;
        if present == 0 {
            match conn.execute("ALTER TABLE notice ADD COLUMN to_session TEXT", []) {
                Ok(_) => {}
                // Another process migrated between the check and the ALTER.
                Err(rusqlite::Error::SqliteFailure(_, Some(m)))
                    if m.contains("duplicate column name") => {}
                Err(e) => return Err(e),
            }
        }
        conn.execute(
            "CREATE INDEX IF NOT EXISTS notice_to_seq ON notice(to_session, seq)",
            [],
        )?;
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
        check(
            "title",
            "characters",
            MAX_TITLE,
            HARD_TITLE,
            n.title.chars().count(),
        )?;
        check(
            "body",
            "characters",
            MAX_BODY,
            HARD_BODY,
            n.body.chars().count(),
        )?;
        check("refs", "items", MAX_REFS, MAX_REFS, n.refs.len())?;
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
             WHERE repo = ?1 AND seq > ?2 AND NOT (author_profile = ?3 AND author_pid = ?4) AND to_session IS NULL
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
             WHERE repo = ?1 AND at_ms >= ?2 AND NOT (author_profile = ?3 AND author_pid = ?4) AND to_session IS NULL
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
    /// Notices addressed to `to_session` with `seq > after`, oldest first, at most `limit`.
    /// It takes no repository: an addressed notice crosses repositories and profiles.
    pub fn direct_after(&self, to_session: &str, after: i64, limit: usize) -> Result<Vec<Notice>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLS} FROM notice
             WHERE to_session = ?1 AND seq > ?2
             ORDER BY seq ASC LIMIT ?3"
        ))?;
        let rows = stmt
            .query_map(params![to_session, after, limit as i64], row_to_notice)?
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
        "INSERT INTO notice (at_ms, repo, author_profile, author_pid, author_session, origin, patch_id, title, body, refs, to_session)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
            refs,
            n.to_session
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
