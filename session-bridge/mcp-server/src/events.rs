//! The event log `<state>/events.jsonl`: one JSON line per delivered item (a nudge, an
//! unfiltered nudge, a gap line, a start view) and per commit whose patch-id was already
//! stored, so the counts of the spec's success check can be read from it.

use crate::diag;
use std::io::Write;
use std::path::Path;

const EVENT_LOG: &str = "events.jsonl";

/// Append `event` as one line to `<state>/events.jsonl` (created when missing, never its
/// directory), with one `write_all`. A failure is noted, never an error.
pub fn append(state: &Path, event: &serde_json::Value) {
    let mut line = event.to_string();
    line.push('\n');
    let written = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.join(EVENT_LOG))
        .and_then(|mut f| f.write_all(line.as_bytes()));
    if let Err(e) = written {
        diag::note(&format!("could not write the event log: {e}"));
    }
}

/// `<short profile>:<pid>`, the endpoint key events carry.
pub fn endpoint_key(profile: &str, pid: u32) -> String {
    format!("{}:{pid}", crate::paths::short_profile(profile))
}
