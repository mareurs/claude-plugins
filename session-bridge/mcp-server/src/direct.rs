//! Addressed notices: the notices one session id received through `post_notice(to=…)`.
//!
//! They are not broadcast and not filtered. A hook asks `take` for the notices addressed to the
//! session ids it knows, and gets text to print or nothing. Delivery is at most once per session
//! id: the direct cursor moves before the text is returned, so a failed cursor write delivers
//! nothing and the next trigger tries again.

use crate::cursor::{get_direct, set_direct};
use crate::deliver::render_direct_all;
use crate::diag;
use crate::endpoints::Roots;
use crate::paths::is_safe_component;
use crate::store::{Notice, Store};
use std::path::Path;

/// Addressed notices delivered per session id in one call, oldest first. The rest wait.
pub const DIRECT_LIMIT: usize = 8;

/// The text for the notices addressed to any of `ids` that this profile `me.0` has not been told
/// yet, or `None`. An id that is not a safe path component is skipped, and so is an id whose
/// store read or cursor write fails: its notices stay for the next call. Every id has its own
/// cursor file, so a session that changed its id (`/clear`) is read under both ids.
pub fn take(
    ids: &[&str],
    me: (&str, u32),
    roots: &Roots,
    state: &Path,
    store: &Store,
) -> Option<String> {
    let mut seen: Vec<&str> = Vec::new();
    let mut items: Vec<Notice> = Vec::new();
    for id in ids.iter().copied() {
        if seen.contains(&id) || !is_safe_component(id) {
            continue;
        }
        seen.push(id);
        let after = get_direct(state, me.0, id);
        let found = match store.direct_after(id, after, DIRECT_LIMIT) {
            Ok(found) => found,
            Err(e) => {
                diag::note(&format!("direct: read notices for {id}: {e}"));
                continue;
            }
        };
        let Some(last) = found.last().map(|n| n.seq) else {
            continue;
        };
        if let Err(e) = set_direct(state, me.0, id, last) {
            diag::note(&format!("direct: cursor for {id}: {e}"));
            continue;
        }
        items.extend(found);
    }
    items.sort_by_key(|n| n.seq);
    render_direct_all(roots, &items)
}
