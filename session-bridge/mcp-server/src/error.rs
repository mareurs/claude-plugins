use thiserror::Error;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("session {0} pid {1} is dead")]
    SessionDied(String, i32),
    #[error("claude CLI not found on PATH")]
    ClaudeCliMissing,
    #[error("subprocess timed out after {0}s")]
    Timeout(u64),
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
}

pub type Result<T> = std::result::Result<T, BridgeError>;
