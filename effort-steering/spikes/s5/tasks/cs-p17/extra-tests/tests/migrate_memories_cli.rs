//! End-to-end behaviour of `codescout migrate-memories --in-place` when the embedding backend
//! refuses inputs above a size limit.
//!
//! The real `codescout` binary runs against a stub OpenAI-compatible backend
//! (`POST /v1/embeddings`). The stub answers every input it accepts with a unit-length 2-d
//! vector derived from the input text, and refuses any input longer than `INPUT_LIMIT_CHARS`
//! characters with the HTTP 500 body llama.cpp sends. Three memories exist:
//!
//! - `small-note`: on disk only, far below the limit;
//! - `big-note`: on disk only, several times the limit;
//! - `stored-big`: already in the sqlite-vec memory store with an old, deliberately non-unit
//!   vector, its content several times the limit.
//!
//! Only what can be seen from outside is asserted: the command's JSON report, the requests the
//! backend accepted, and the vectors left in the store. Nothing here names how a fix splits or
//! combines anything.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use assert_cmd::Command;
use codescout::memory::semantic_store::SemanticMemoryStore;
use codescout::memory::sqlite_semantic_store::SqliteVecSemanticMemoryStore;
use codescout::retrieval::memory_payload::SemanticMemory;
use tempfile::TempDir;

/// The stub refuses any single input longer than this many characters.
const INPUT_LIMIT_CHARS: usize = 1500;
/// The project directory's name, which is the project id the store is keyed by.
const PROJECT: &str = "migrate-cli-proj";
/// Lines in each long memory (about 80 characters a line, so about 5,500 characters).
const LONG_LINES: usize = 70;
/// What the store holds for `stored-big` before the command runs: not unit length, and not
/// anything the stub can return, so that "left alone" and "re-derived" cannot be confused.
const OLD_VECTOR: [f32; 2] = [0.0, 3.0];

// ---------------------------------------------------------------------------------------
// The stub backend
// ---------------------------------------------------------------------------------------

#[derive(Default, Clone)]
struct Seen {
    /// Every input text the stub accepted (answered with a vector).
    accepted: Vec<String>,
}

struct StubBackend {
    url: String,
    seen: Arc<Mutex<Seen>>,
}

impl StubBackend {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub backend");
        let port = listener.local_addr().expect("stub backend address").port();
        let seen = Arc::new(Mutex::new(Seen::default()));
        let shared = Arc::clone(&seen);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let shared = Arc::clone(&shared);
                std::thread::spawn(move || {
                    let _ = serve(stream, &shared);
                });
            }
        });
        Self {
            url: format!("http://127.0.0.1:{port}"),
            seen,
        }
    }

    fn accepted(&self) -> Vec<String> {
        self.seen.lock().unwrap().accepted.clone()
    }
}

/// A unit-length 2-d vector whose direction depends on the text (FNV-1a over its bytes), so
/// that two different texts almost surely get different directions and the mean of several
/// of them is visibly shorter than 1 unless it is renormalised.
fn direction(text: &str) -> [f32; 2] {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    let angle = (hash % 3600) as f32 * std::f32::consts::TAU / 3600.0;
    [angle.cos(), angle.sin()]
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()
}

fn serve(mut stream: TcpStream, seen: &Mutex<Seen>) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }
    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;

    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    if !path.ends_with("/v1/embeddings") {
        return respond(&mut stream, "404 Not Found", "{}");
    }

    let parsed: serde_json::Value =
        serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let inputs: Vec<String> = match &parsed["input"] {
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        serde_json::Value::String(s) => vec![s.clone()],
        _ => Vec::new(),
    };

    if inputs.iter().any(|t| t.chars().count() > INPUT_LIMIT_CHARS) {
        let refusal = r#"{"error":{"code":500,"message":"input is too large to process. increase the physical batch size","type":"server_error"}}"#;
        return respond(&mut stream, "500 Internal Server Error", refusal);
    }

    let data: Vec<serde_json::Value> = inputs
        .iter()
        .enumerate()
        .map(|(index, text)| {
            serde_json::json!({
                "object": "embedding",
                "index": index,
                "embedding": direction(text),
            })
        })
        .collect();
    let answer = serde_json::json!({ "object": "list", "data": data, "model": "stub" });
    seen.lock().unwrap().accepted.extend(inputs);
    respond(&mut stream, "200 OK", &answer.to_string())
}

// ---------------------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------------------

fn long_memory(tag: &str) -> String {
    (0..LONG_LINES)
        .map(|i| {
            format!("{tag}-LINE-{i:03} the quick brown fox jumps over the lazy dog, again and again\n")
        })
        .collect()
}

fn marker(tag: &str, line: usize) -> String {
    format!("{tag}-LINE-{line:03}")
}

/// Put `stored-big` into the sqlite-vec memory store, bucket and project as the command will
/// look for them, with `OLD_VECTOR` as its vector.
fn seed_stored_memory(sqlite_dir: &Path) {
    let store = SqliteVecSemanticMemoryStore::at(sqlite_dir.to_path_buf());
    let memory = SemanticMemory {
        project_id: PROJECT.to_string(),
        bucket: codescout::memory::TOPIC_BUCKET.to_string(),
        title: "stored-big".to_string(),
        content: long_memory("stored-big"),
        anchors: Vec::new(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    };
    tokio::runtime::Runtime::new()
        .expect("tokio runtime")
        .block_on(store.upsert(&memory, &OLD_VECTOR))
        .expect("seed the stored memory");
}

struct Run {
    report: serde_json::Value,
    accepted: Vec<String>,
    sqlite_dir: PathBuf,
    _tmp: TempDir,
}

fn run_scenario() -> Run {
    let tmp = TempDir::new().expect("tempdir");
    let root = tmp.path().join(PROJECT);
    let memories = root.join(".codescout").join("memories");
    std::fs::create_dir_all(&memories).expect("memories dir");
    std::fs::write(
        memories.join("small-note.md"),
        "A short note.\nIt fits in one request.\n",
    )
    .expect("write small-note");
    std::fs::write(memories.join("big-note.md"), long_memory("big-note"))
        .expect("write big-note");

    let sqlite_dir = tmp.path().join("vec");
    seed_stored_memory(&sqlite_dir);

    let home = tmp.path().join("home");
    std::fs::create_dir_all(&home).expect("home dir");

    let backend = StubBackend::start();
    let mut cmd = Command::cargo_bin("codescout").expect("the codescout binary");
    cmd.current_dir(&root)
        .args(["migrate-memories", "--in-place", "--project"])
        .arg(&root)
        // Hermetic: no startup dotenv, no global config, no proxy, no leftover embedder env.
        .env("CODESCOUT_ENV_FILE", tmp.path().join("no-startup.env"))
        .env("HOME", &home)
        .env("XDG_CONFIG_HOME", tmp.path().join("xdg"))
        .env("NO_PROXY", "127.0.0.1,localhost")
        .env("no_proxy", "127.0.0.1,localhost")
        .env_remove("HTTP_PROXY")
        .env_remove("http_proxy")
        .env_remove("HTTPS_PROXY")
        .env_remove("https_proxy")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy")
        .env_remove("CODESCOUT_EMBED_MODEL")
        .env_remove("CODESCOUT_EMBED_URL")
        .env_remove("CODESCOUT_EMBEDDER_MODEL_NAME")
        .env_remove("CODESCOUT_QUERY_PREFIX")
        .env_remove("CODESCOUT_EMBED_BATCH")
        .env_remove("CODESCOUT_EMBED_INFLIGHT")
        .env_remove("CODESCOUT_DISABLE_SPARSE")
        .env_remove("CODESCOUT_SPARSE_EMBEDDER_URL")
        .env_remove("EMBED_API_KEY")
        // The scenario's whole configuration.
        .env("CODESCOUT_VECTOR_BACKEND", "sqlite-vec")
        .env("CODESCOUT_SQLITE_DIR", &sqlite_dir)
        .env("CODESCOUT_EMBEDDER_URL", &backend.url)
        .env("CODESCOUT_EMBEDDER_MODEL", "unit-test-embed")
        .env("CODESCOUT_MODEL_DIM", "2")
        .timeout(Duration::from_secs(120));
    let output = cmd.output().expect("run codescout migrate-memories");
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(
        output.status.success(),
        "migrate-memories --in-place must exit 0; status {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        output.status
    );

    let report = stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line.trim()).ok())
        .filter(|value| value.get("skipped").is_some())
        .last()
        .unwrap_or_else(|| panic!("no JSON report on stdout:\n{stdout}\nstderr:\n{stderr}"));

    Run {
        report,
        accepted: backend.accepted(),
        sqlite_dir,
        _tmp: tmp,
    }
}

/// Title -> stored vector, read straight from the memory store's database.
fn stored_vectors(sqlite_dir: &Path) -> BTreeMap<String, Vec<f32>> {
    codescout::sqlite_vec_ext::register();
    let db = sqlite_dir.join(format!(
        "{}.memories.db",
        codescout::sqlite_vec_ext::sanitize_db_name(PROJECT)
    ));
    let conn = rusqlite::Connection::open(&db).expect("open the memory store");
    let mut items = conn
        .prepare("SELECT point_id, json FROM memory_item")
        .expect("prepare memory_item");
    let rows: Vec<(String, String)> = items
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .expect("query memory_item")
        .collect::<Result<_, _>>()
        .expect("read memory_item");

    let mut out = BTreeMap::new();
    for (point_id, json) in rows {
        let memory: serde_json::Value = serde_json::from_str(&json).expect("memory json");
        let title = memory["title"].as_str().expect("memory title").to_string();
        let blob: Vec<u8> = conn
            .query_row(
                "SELECT embedding FROM memory_vec WHERE point_id = ?1",
                rusqlite::params![point_id],
                |r| r.get::<_, Vec<u8>>(0),
            )
            .unwrap_or_else(|e| panic!("no vector row for {title}: {e}"));
        let vector = blob
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        out.insert(title, vector);
    }
    out
}

// ---------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------

#[test]
fn in_place_migration_embeds_every_memory_when_one_exceeds_the_backend_limit() {
    let run = run_scenario();
    assert_eq!(
        run.report["skipped"], 0,
        "nothing may be skipped; report: {}",
        run.report
    );
    assert_eq!(
        run.report["read"], 3,
        "all three memories are in scope; report: {}",
        run.report
    );
    assert_eq!(
        run.report["upserted"], 3,
        "all three memories must be embedded and written; report: {}",
        run.report
    );
}

/// True when `marker` reached the backend: whole inside one accepted input, or cut in two at
/// an input boundary (one accepted input ends with its head, another holds its tail). A fix
/// may split anywhere; what must not happen is that part of the text never arrives.
fn reached_backend(accepted: &[String], marker: &str) -> bool {
    if accepted.iter().any(|input| input.contains(marker)) {
        return true;
    }
    (1..marker.len()).any(|cut| {
        let (head, tail) = marker.split_at(cut);
        accepted.iter().any(|a| a.ends_with(head)) && accepted.iter().any(|b| b.contains(tail))
    })
}

#[test]
fn in_place_migration_sends_every_part_of_a_long_memory_to_the_backend() {
    let run = run_scenario();
    for tag in ["big-note", "stored-big"] {
        for line in 0..LONG_LINES {
            let needle = marker(tag, line);
            assert!(
                reached_backend(&run.accepted, &needle),
                "no input the backend accepted contains {needle}, whole or split across two \
                 inputs: part of {tag} never got embedded ({} accepted inputs)",
                run.accepted.len()
            );
        }
    }
}

#[test]
fn in_place_migration_stores_unit_length_vectors_for_long_memories() {
    let run = run_scenario();
    let stored = stored_vectors(&run.sqlite_dir);
    let titles: Vec<&String> = stored.keys().collect();
    for title in ["small-note", "big-note", "stored-big"] {
        assert!(
            stored.contains_key(title),
            "no vector was stored for {title}; the store holds {titles:?}"
        );
        let vector = &stored[title];
        assert_eq!(vector.len(), 2, "{title}: wrong dimension: {vector:?}");
        let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(
            (norm - 1.0).abs() < 1e-3,
            "{title}: the stored vector must have length 1 (the store ranks by L2 distance), \
             got {norm} for {vector:?}"
        );
    }
}
