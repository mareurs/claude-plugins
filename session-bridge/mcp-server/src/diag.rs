//! Diagnostics that can never panic. `eprintln!` panics when stderr is closed (EPIPE), and a
//! panic in a hook exits 101; hooks must exit 0 whatever happens.

use std::io::Write;

/// Write `session-bridge: <msg>` to stderr; a closed or broken stderr is ignored.
pub fn note(msg: &str) {
    let _ = writeln!(std::io::stderr(), "session-bridge: {msg}");
}
