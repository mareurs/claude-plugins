# Integrating pi with Claude Code plugins, skills, and a local LLM proxy

This doc captures the setup patterns used to wire
[pi](https://github.com/earendil-works/pi-mono) into the same plugin/skill
ecosystem as Claude Code, and to route all of pi's LLM traffic through a local
proxy for observability. It is a reference, not an installer — adapt the paths
to your own machine.

## Table of contents

- [Skill sources and versioning](#skill-sources-and-versioning)
- [LLM proxy routing](#llm-proxy-routing)
- [Local model providers](#local-model-providers)

## Skill sources and versioning

pi loads skills from the directories listed in the `skills` array of
`~/.pi/agent/settings.json`. Skills follow the
[Agent Skills standard](https://agentskills.io/specification) — a directory
with a `SKILL.md` containing `name` + `description` frontmatter — so any Claude
Code skill directory works unchanged.

The challenge with Claude Code plugin caches is that every release installs a
new versioned directory (`.../superpowers/6.0.3/`, `.../superpowers/6.0.4/`,
…) and the version is in the path. Pinning a version means editing
`settings.json` after every plugin update. Two strategies avoid this:

### Git checkout (preferred when you have a local clone)

If the plugin lives in a git repo on disk, point `settings.json` at the repo's
`skills/` directory directly. `git pull` keeps it current — no version in the
path.

```json
{
  "skills": [
    "/home/you/work/claude-plugins/codescout-companion/skills",
    "/home/you/work/claude-plugins/buddy/skills"
  ]
}
```

### `latest` symlink (for cache-only plugins)

For plugins that only exist in the versioned Claude Code cache, create a
`latest` symlink alongside the versioned directories and point `settings.json`
at it:

```bash
CACHE=~/.claude/plugins/cache/superpowers-marketplace/superpowers
LATEST=$(ls -d "$CACHE"/*/ | grep -v '/latest/' | sort -V | tail -1 | xargs basename)
ln -sfn "$LATEST" "$CACHE/latest"
```

```json
{
  "skills": [
    "/home/you/.claude/plugins/cache/superpowers-marketplace/superpowers/latest/skills"
  ]
}
```

After `claude plugin update`, re-point the symlinks. A small script automates
this — it scans each configured cache dir, finds the highest semver, and
repoints `latest`:

```bash
#!/usr/bin/env bash
set -euo pipefail

repoint() {
  local cache_dir="$1" label="$2"
  [ -d "$cache_dir" ] || { echo "  skip: $label (not found)"; return; }
  local latest
  latest=$(ls -d "$cache_dir"/*/ 2>/dev/null | grep -v '/latest/' | sort -V | tail -1 | xargs basename)
  [ -n "$latest" ] || { echo "  skip: $label (no versions)"; return; }
  ln -sfn "$latest" "$cache_dir/latest"
  echo "  $label -> $latest"
}

repoint "$HOME/.claude/plugins/cache/superpowers-marketplace/superpowers" "superpowers"
```

### Excluding a skill

The `skills` array supports `-path` force-excludes. Useful when a bundled
plugin ships a skill you don't want:

```json
{
  "skills": [
    "/home/you/.claude/plugins/cache/anthropic-agent-skills/.../skills",
    "-/home/you/.claude/plugins/cache/anthropic-agent-skills/.../skills/claude-api"
  ]
}
```

### Skill name validation

pi warns (but still loads) skills whose `name` frontmatter field violates the
spec (lowercase `a-z`, `0-9`, hyphens only). If you maintain a skill repo,
keep `name` lowercase-hyphenated and matching the directory name. The slash
command `/skill:<name>` only works with the compliant form.

## LLM proxy routing

pi's `models.json` (`~/.pi/agent/models.json`) lets you override any built-in
provider's `baseUrl` to point at a proxy. The proxy must speak the same API as
the original provider — for Anthropic and GitHub Copilot, that's the
[Anthropic Messages API](https://docs.anthropic.com/en/api/messages).

### Single upstream

If the proxy has a fixed upstream (e.g. it always forwards to Anthropic), just
override the base URL:

```json
{
  "providers": {
    "anthropic": { "baseUrl": "http://localhost:8082" }
  }
}
```

All built-in Anthropic models remain available; existing auth (API key or
OAuth) continues to work. The proxy receives the original `Authorization` /
`x-api-key` headers and forwards them.

### Multiple upstreams through one proxy

GitHub Copilot models already use the Anthropic Messages API — they just point
at `https://api.individual.githubcopilot.com` instead of `api.anthropic.com`.
So one proxy can serve both providers if it can pick the right upstream per
request.

The contract: a client-supplied `X-Proxy-Upstream` header tells the proxy
which upstream to use. The proxy reads it, uses it as the forward URL, and
strips it before forwarding (so it never leaks upstream). If the header is
absent, the proxy falls back to its configured default upstream.

pi injects the header per-provider via `models.json`:

```json
{
  "providers": {
    "anthropic": { "baseUrl": "http://localhost:8082" },
    "github-copilot": {
      "baseUrl": "http://localhost:8082",
      "headers": { "X-Proxy-Upstream": "https://api.individual.githubcopilot.com" }
    }
  }
}
```

Now every request — whether pi uses the `anthropic` or `github-copilot`
provider — hits `http://localhost:8082/v1/messages`. The proxy logs each to
Langfuse (or whatever observability backend it's wired to) and forwards to the
correct upstream based on the header.

### Proxy implementation sketch

The proxy is a thin reverse proxy over the Anthropic Messages API. The dynamic
upstream is a ~10-line addition to the passthrough handler:

```rust
// Honour a client-supplied upstream override; otherwise use the configured
// default + fallback chain. The header is NOT in the forwarded allowlist, so
// it never leaks upstream.
let chain: Vec<String> = headers
    .get("x-proxy-upstream")
    .and_then(|v| v.to_str().ok())
    .map(|s| vec![resolve_upstream_url(s)])
    .unwrap_or_else(|| fallback_chain(&state.anthropic_upstream_url, &state.anthropic_fallback_url));
```

Key invariants:
- The proxy must return errors in Anthropic error JSON format — clients use
  the Anthropic SDK and raw upstream errors will crash deserialization.
- `X-Proxy-Upstream` must be stripped before forwarding (keep it out of the
  forwarded-header allowlist).
- Streaming responses must be forwarded byte-for-byte; accumulate for logging
  in a background task, don't block the stream.

## Local model providers

Local models (llama.cpp / vLLM / Ollama / LM Studio) are added as a custom
provider in `models.json`. The provider speaks the OpenAI Completions API:

```json
{
  "providers": {
    "local": {
      "baseUrl": "http://localhost:43000/v1",
      "api": "openai-completions",
      "apiKey": "not-needed",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "my-model-q4_k_m",
          "name": "My Model (local, fast)",
          "contextWindow": 32768,
          "maxTokens": 8192,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

`compat` flags matter for llama.cpp-based servers, which often don't
understand OpenAI's `developer` role or `reasoning_effort` param. Set both to
`false` or pi will send params the server rejects.

For thinking-capable models, add `"reasoning": true` and a `thinkingLevelMap`
to control which thinking levels pi exposes in the UI. Use `null` to hide a
level the model doesn't support:

```json
{
  "id": "my-model-thinking",
  "reasoning": true,
  "thinkingLevelMap": { "minimal": null, "low": null, "medium": null, "high": null, "xhigh": null }
}
```

### Multiple variants of one model

If your local server exposes thinking and non-thinking variants of the same
base model (e.g. via `chat_template_kwargs.enable_thinking`), list them as
separate model entries with distinct `id`s. A litellm proxy in front of
llama-server can generate these variants automatically from the model's chat
template — detect `enable_thinking` support and emit `model`,
`model-thinking`, and `model-auto` entries.
