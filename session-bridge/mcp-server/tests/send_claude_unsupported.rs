//! `send_message` never delivers to a Claude Code session: a Claude target is refused with
//! an explicit error pointing at `ask_session`, and nothing is stored. A notices.db left
//! behind by a build that stored direct messages (with a `direct_messages` table) still
//! opens and carries notices.

use session_bridge_mcp::endpoints::{Endpoint, Roots};
use session_bridge_mcp::opencode::OpenCodeEndpoint;
use session_bridge_mcp::sessions::Session;
use session_bridge_mcp::store::{NewNotice, Origin, Store};
use session_bridge_mcp::tools::{send_message, SendMessageArgs};
use std::path::Path;
use tempfile::TempDir;

const UNSUPPORTED: &str =
    "direct messages support Codex and OpenCode targets only; use ask_session for Claude";

fn claude(profile: &str, pid: u32, session: &str, root: &Path) -> Session {
    Session::Claude(Endpoint {
        profile: profile.into(),
        config_dir: root.join(profile),
        pid,
        session_id: session.into(),
        name: None,
        kind: None,
        status: None,
        launch_cwd: root.join("repo"),
        repo: None,
    })
}

fn opencode(id: &str, root: &Path) -> Session {
    Session::OpenCode(OpenCodeEndpoint {
        data_dir: root.join("opencode"),
        session_id: id.into(),
        title: None,
        directory: Some(root.join("repo")),
        running: false,
        last_active_ms: 0,
    })
}

/// Every file under `dir`, recursively.
fn files(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = vec![];
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            out.extend(files(&p));
        } else {
            out.push(p);
        }
    }
    out
}

#[tokio::test]
async fn send_message_to_claude_is_unsupported() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let roots = Roots {
        proc_root: root.join("proc"),
        socks: root.join("socks"),
    };
    let target = claude(".claude-stef", 20, "S", root);
    let callers = [
        claude(".claude-kat", 5, "K", root),
        opencode("ses_caller1", root),
    ];
    for caller in &callers {
        let sessions = vec![target.clone(), caller.clone()];
        let err = send_message(
            caller,
            &sessions,
            &[],
            SendMessageArgs {
                target: "stef:20".into(),
                message: "hello".into(),
                timeout_s: None,
            },
            &roots,
        )
        .await
        .expect_err("a Claude target is refused");
        assert_eq!(err.to_string(), UNSUPPORTED, "caller {}", caller.identity());
    }
    // nothing was written anywhere: no store, no state
    assert!(files(root).is_empty(), "{:?}", files(root));
}

#[test]
fn leftover_direct_messages_table_still_opens() {
    let tmp = TempDir::new().unwrap();
    let db = tmp.path().join("notices.db");
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE direct_messages (id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL,
                expires_ms INTEGER NOT NULL, target_profile TEXT NOT NULL,
                target_pid INTEGER NOT NULL, target_session TEXT NOT NULL,
                sender TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
                delivered_ms INTEGER, target_start_ms INTEGER, target_config_dir TEXT);
             INSERT INTO direct_messages VALUES ('dm-1', 1, 2, '.claude-stef', 20, 'S',
                'kat', 'old', 'pending', NULL, NULL, NULL);",
        )
        .unwrap();
    }
    let store = Store::open(&db).unwrap();
    let seq = store
        .post(NewNotice {
            at_ms: 1000,
            repo: "/work/r".into(),
            author_profile: ".claude-kat".into(),
            author_pid: 2,
            author_session: "sess".into(),
            origin: Origin::Manual,
            patch_id: None,
            title: "t".into(),
            body: "b".into(),
            refs: vec![],
        })
        .unwrap();
    let page = store.after("/work/r", 0, (".claude-stef", 1)).unwrap();
    assert_eq!(page.notices.len(), 1);
    assert_eq!(page.notices[0].seq, seq);
    // a second open of the same file works too, and the leftover table is left alone
    drop(store);
    Store::open(&db).unwrap();
    let conn = rusqlite::Connection::open(&db).unwrap();
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM direct_messages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
}
