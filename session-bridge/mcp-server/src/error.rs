use thiserror::Error;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("session {0} pid {1} is dead")]
    SessionDied(String, i32),
    #[error("claude CLI not found on PATH")]
    ClaudeCliMissing,
    #[error("subprocess timed out after {0}s")]
    Timeout(u64),
    #[error("daily ask bound reached: {spent:.2} USD spent today, bound {bound:.2} USD")]
    BudgetExceeded { spent: f64, bound: f64 },
    #[error("claude binary {0:?} is not an absolute path; resolve it first (SESSION_BRIDGE_CLAUDE_BIN must be absolute)")]
    RelativeBinary(String),
    #[error("unreadable fork output: {0}")]
    BadForkOutput(String),
    #[error("the fork reported an error: {0}")]
    ForkFailed(String),
    #[error("no live session matches {target:?}; live sessions: {}", .candidates.join("; "))]
    TargetNotFound { target: String, candidates: Vec<String> },
    #[error("{target:?} matches more than one session; use a longer id or a <profile>: prefix: {}", .candidates.join("; "))]
    AmbiguousTarget { target: String, candidates: Vec<String> },
    #[error("the target is the calling session itself")]
    TargetIsSelf,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("{field} over the limit: {actual} exceeds {limit}")]
    OverLimit { field: &'static str, limit: usize, actual: usize },
    #[error("notice store: {0}")]
    Store(#[from] rusqlite::Error),
    #[error("not in a git repository")]
    NotInRepo,
    #[error("state directory not available: set HOME or XDG_STATE_HOME")]
    NoStateDir,
}

pub type Result<T> = std::result::Result<T, BridgeError>;
