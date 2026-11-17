//! OpenCode background-service client over the `opencode api` CLI. The CLI already resolves
//! the service URL and its password; the body travels as one argv element, never via a shell.
use crate::codex_process::run_bounded;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::{
    future::Future,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;

pub trait OcApi {
    fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> impl Future<Output = Result<Value>> + Send;
}

pub struct CliApi {
    pub bin: PathBuf,
    pub timeout: Duration,
}

impl OcApi for CliApi {
    fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> impl Future<Output = Result<Value>> + Send {
        let mut cmd = Command::new(&self.bin);
        cmd.arg("api").arg(method).arg(path);
        if let Some(b) = body {
            cmd.arg("-d").arg(b.to_string());
        }
        let timeout = self.timeout;
        async move {
            let out = run_bounded(&mut cmd, timeout).await?;
            let text = out.stdout.trim();
            anyhow::ensure!(
                out.status.success(),
                "opencode api failed ({}): {}",
                out.status,
                first_line(if text.is_empty() { &out.stderr } else { text })
            );
            // An HTTP error or the web UI's HTML is never a JSON body.
            serde_json::from_str(text)
                .map_err(|_| anyhow!("opencode api returned non-JSON: {}", first_line(text)))
        }
    }
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or("").chars().take(200).collect()
}

pub fn locate_opencode(env: &dyn Fn(&str) -> Option<String>) -> Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let executable = |p: &Path| {
        p.is_file()
            && p.metadata()
                .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    };
    if let Some(bin) = env("SESSION_BRIDGE_OPENCODE_BIN").filter(|s| !s.is_empty()) {
        let p = PathBuf::from(bin);
        anyhow::ensure!(
            p.is_absolute(),
            "SESSION_BRIDGE_OPENCODE_BIN must be absolute"
        );
        anyhow::ensure!(executable(&p), "OpenCode binary is not executable");
        return Ok(p);
    }
    for dir in std::env::split_paths(&env("PATH").unwrap_or_default()) {
        if !dir.is_absolute() {
            continue;
        }
        let p = dir.join("opencode");
        if executable(&p) {
            return Ok(p);
        }
    }
    Err(anyhow!("opencode CLI not found on PATH"))
}

/// Probe the service; if it is down, start it once and probe once more.
pub async fn ensure_service(api: &impl OcApi, bin: &Path) -> Result<()> {
    if api.call("GET", "/api/session/active", None).await.is_ok() {
        return Ok(());
    }
    let mut start = Command::new(bin);
    start.args(["service", "start"]);
    let out = run_bounded(&mut start, Duration::from_secs(10))
        .await
        .context("could not start the OpenCode service")?;
    anyhow::ensure!(
        out.status.success(),
        "opencode service start failed ({})",
        out.status
    );
    api.call("GET", "/api/session/active", None)
        .await
        .context("OpenCode service did not come up after start")?;
    Ok(())
}

/// `$XDG_DATA_HOME/opencode`, else `$HOME/.local/share/opencode`, canonicalized.
pub fn data_dir(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let base = match env("XDG_DATA_HOME").filter(|s| !s.is_empty()) {
        Some(x) => PathBuf::from(x),
        None => PathBuf::from(env("HOME").filter(|s| !s.is_empty())?).join(".local/share"),
    };
    base.join("opencode").canonicalize().ok()
}
