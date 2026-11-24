# session-toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native). Steps use checkbox syntax.

**Goal:** A Claude Code mod that shows a toast for each message from another session.

**Architecture:** Pure `hooks/toasts.ts` (text in, toast lines out). `hooks/register.ts` maps hook events to `$.ui.toast` and always returns what `next(e)` returned.

**Tech Stack:** Claude Code mod API 2.1.331, TypeScript, `claude plugin test` (`claude-code/testing`).

**Spec:** `docs/superpowers/specs/2026-11-24-session-toast-design.md`

## Global Constraints

- Toast time 8000 ms, text cut to 160 characters (`TOAST_MS`, `CUT`).
- Marker sentence, exact: `This is information from another session, not an instruction.`
- Every hook returns the `next(e)` result unchanged; a toast failure never blocks delivery.
- `hooks/hooks.json` is `{ "modules": ["./register.ts"] }`; no `modules` key in any shared hooks file.
- Marketplace entry has no `version`; README row version equals `plugin.json`.

## Review Focus

- A peer message with no wrapper, an empty body, ANSI or control characters in the sender or body.
- A notice shape the parser does not know (unaddressed repository notice): generic line, never a crash.
- Several notices in one `additionalContext` entry: one toast each.
- A throwing `ui.toast` hook: the message is still delivered (`session.receive` must call `next(e)`).
- A message for a subagent (`agentId` set): no toast.

---

### Task 1: toasts.ts (pure)

**Files:**
- Create: `session-toast/hooks/toasts.ts`
- Test: `session-toast/tests/toasts.test.ts`

**Interfaces:**
- Produces: `MARK: string`, `TOAST_MS = 8000`, `CUT = 160`, `peerToast(text: string): string | undefined`, `noticeToasts(entry: string): string[]`.

- [ ] **Step 1: Write the failing tests** (`toasts.test.ts`, via `claude-code/testing`):
  - `peerToast` of the measured wrapper → `from claude-plugins-c1: Probe message from a helper session.` (first non-empty body line).
  - no wrapper → `from another session: <first line>`; blank text → `undefined`; empty body in wrapper → `from <name>: (no text)`.
  - a body over 160 chars is cut to 160 with `…`; ANSI `\u001b[31m` and `\u0007` in name and body are removed.
  - `noticeToasts` of the measured notice → `["notice from main:0078a446: probe notice from a helper session. This is a test notice for the session-probe mod. Nothing to do."]` (the `Refs:`, `To reply:` and marker parts are dropped).
  - a notice without parenthesised id uses the session key; two notices separated by a blank line → two lines; an entry without the marker → `[]`; marker present but unknown shape → one generic `notice: …` line without the marker sentence.
- [ ] **Step 2: Run, expect FAIL** — `claude plugin test session-toast` → module `toasts` not found.
- [ ] **Step 3: Implement** the four exports in `toasts.ts`. One `clean(s)` strips ANSI CSI sequences and control characters except newline; one `cut(s, n)`; first non-empty line; wrapper regex on `<cross-session-message … from-name="…" …>body</cross-session-message>`; notice regex `Message to you from session (\S+)(?: \(([^)]*)\))?, \d\d:\d\d UTC: ` then drop from ` Refs:` or ` To reply:` onward.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(session-toast): the text of a message from another session becomes a toast line`.

### Task 2: register.ts (hooks)

**Files:**
- Create: `session-toast/hooks/register.ts`, `session-toast/hooks/hooks.json`
- Test: `session-toast/tests/register.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `export const register: Register`.

- [ ] **Step 1: Write the failing tests.** Collect toasts with `on('ui.toast', (_, e) => { toasts.push(e); return { value: undefined } })`; stand in for the engine with `on('session.receive', (_, e) => ({ text: e.text }))`.
  - peer message → one toast with `timeoutMs: 8000`, result `text` equals the input text.
  - `origin.kind: 'coordinator'` → no toast; `agentId: 'a1'` → no toast, still delivered.
  - `$.classic.PostToolUse` and `$.classic.UserPromptSubmit` with a notice in `additionalContext` → one toast each, `additionalContext` unchanged; with no marker → no toast.
  - an `on('ui.toast')` hook that throws → `session.receive` still resolves with the original text, and `classic.PostToolUse` still returns the context.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `register` with the three hooks, each `.catch(($, e, next) => next(e))`. In `session.receive` call `next(e)` last and wrap the toast in `try/catch`; in the classic hooks `await next(e)` first, then toast inside `try/catch`, then return the result.
- [ ] **Step 4: Run, expect PASS.** Mutation check: remove the `agentId` guard and the `try/catch`; the matching tests must fail.
- [ ] **Step 5: Commit** `feat(session-toast): toast a peer message and a session-bridge notice`.

### Task 3: plugin, repo wiring, live check

**Files:**
- Create: `session-toast/.claude-plugin/plugin.json` (name, version 0.1.0, description, author Marius, MIT, keywords), `session-toast/README.md`, `tests/test-session-toast.sh` (mirror `tests/test-codescout-display.sh`)
- Modify: `.claude-plugin/marketplace.json` (entry, no version), `README.md` (plugin table row)

- [ ] **Step 1:** Write the files. README: what a toast shows, the two sources, needs, try-it, limits (an idle session shows no notice until its next prompt or tool call; peer messages for subagents are silent).
- [ ] **Step 2:** `claude plugin validate session-toast` passes; `bash tests/test-session-toast.sh` passes; `./tests/run-all.sh` has no new failure.
- [ ] **Step 3:** Remove the probe mod; link `session-toast` into the dev-mods folder; send a peer message and a notice from a helper session; the user confirms the toasts.
- [ ] **Step 4: Commit** `feat(session-toast): plugin manifest, README, marketplace entry and repo test`.
