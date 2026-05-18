use thiserror::Error;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("no sessions registered")]
    NoSessionsRegistered,
    #[error("session not found for ref {0:?}; current: {1:?}")]
    SessionNotFound(String, Vec<String>),
    #[error("ambiguous ref {0:?}; matches: {1:?}")]
    AmbiguousRef(String, Vec<String>),
    #[error("session {0} pid {1} is dead")]
    SessionDied(String, i32),
    #[error("claude CLI not found on PATH")]
    ClaudeCliMissing,
    #[error("subprocess timed out after {0}s")]
    Timeout(u64),
    #[error("session {0} busy: bidirectional lock held")]
    SessionBusy(String),
    #[error("registry corrupt: {0}")]
    RegistryCorrupt(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, BridgeError>;
