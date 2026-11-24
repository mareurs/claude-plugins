# codescout-display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod, `codescout-display`, draws each codescout tool call as one compact card in verbose mode: a header, a view fitted to the tool, a fold for long results.

**Architecture:** All decisions live in `hooks/cards.ts`, a pure module: `buildCard(tool, input, output)` returns a `Card` or `undefined` (pass through). `hooks/register.tsx` is one `ui.render` hook on `ToolUse`: it checks the gate, calls `buildCard`, and maps the `Card` to elements. A card replaces the engine row. The model's context never changes.

**Tech Stack:** TypeScript and JSX in a Claude Code hooks module (no Node, no DOM), `claude plugin test` and `claude plugin validate` (Claude Code 2.1.331), bash for the repo test script.

**Spec:** `docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md` (read it first). Measurements: the codescout memory `research/codescout-display-probe-20261124`. Sibling plugin to copy layout and test style from: `codescout-redirect/`.

## Global Constraints

- Separate plugin `codescout-display`, version `0.1.0`, author `Marius`, license `MIT`. Claude Code only, `terminal` surface only.
- `hooks/hooks.json` is `{ "modules": ["./register.tsx"] }`: one path, nothing else in the file. Do not add a `modules` key to `codescout-companion/hooks/hooks.json`.
- The hook acts only when ALL hold: `e.surface === 'terminal'`; `e.props.isExpanded === true`; `e.props.tool` starts with `mcp__codescout__`; `isRunning` false; `isErrored` false; `output` defined. Otherwise `return next(e)`. Every hook has `.catch(($, e, next) => next(e))`.
- Never rewrite `input` or `output`. A card replaces the row. There is no other treatment.
- A function that receives `$` is a top-level function declaration of `register.tsx`, or `claude plugin validate` refuses the module. Helpers that take no `$` may live in other files.
- Fold at `HEAD_LINES = 12`; hidden line reads `… N more lines hidden`. JSON summary: at most 6 top-level scalar fields, each value cut at 40 characters. A reply is JSON when block 0 parses to an object.
- Strip control characters other than tab and newline (`/[\u0000-\u0008\u000b-\u001f\u007f]/g`) from every string handed to `Text` or `Code`.
- Replies: `output` is `[{ type: 'text', text }, ...]`. Block 0 is the reply; later blocks are hook notes.
- If the open control cannot work, the card folds anyway: an error is never folded, each hook note is one dim line with `wrap: 'truncate-end'`.
- Repo rules: write English; `git add` explicit paths, never `-A`; commit each finished task; end each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; do not push; do not run `release.sh`.

## Review Focus

1. An empty or malformed `output` (`[]`, a block with no `text`, a string) draws the engine row, never a blank card or a crash. Test in Task 2.
2. The fold boundary: exactly 12 lines draws no hidden line; 13 draws `… 1 more lines hidden`; a trailing newline is not a line. Test in Task 2.
3. A 100,000-character reply or a single very long line: the head is sliced before drawing, so a draw stays cheap and `Code` gets under its 100,000-character limit. Test in Task 3.
4. A reply with ANSI escapes or other control characters is stripped, so the engine does not refuse the tree. Test in Task 2.
5. A `read_file` reply that is an outline (`N lines  @file_…`) or an `edit_file` call with no `old_string` (insert, markdown, heading modes) takes the generic card, with no gutter and no diff. Test in Task 3.

---

## File Structure

```
codescout-display/
  .claude-plugin/plugin.json      manifest (copy the shape of codescout-redirect's)
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/cards.ts                  pure: reply parsing, folding, Card building. No `$`, no JSX.
  hooks/register.tsx              ui.render hook: gate, buildCard, Card -> elements
  tests/cards.test.ts             pure tests of cards.ts
  tests/register.test.tsx         mounted tests of the hook, per surface
  README.md                       what it does, limits, how to load it
tests/test-codescout-display.sh   repo test: layout, no modules key in shared files, claude plugin test
```

Also modified: `.claude-plugin/marketplace.json` (one entry), `README.md` (one table row).

### Task 1: Scaffold and gates

A scaffold that validates, plus three facts the later tasks depend on. Record each finding as a comment at the top of the file that uses it, and as a line in the spec's Results table.

**Files:**
- Create: `codescout-display/.claude-plugin/plugin.json`, `codescout-display/hooks/hooks.json`, `codescout-display/hooks/register.tsx` (a stub hook that returns `next(e)`), `codescout-display/tests/register.test.tsx`
- Modify: `docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md` (Results)

**Interfaces:**
- Produces: a loadable plugin; the names of the test kit calls Task 4 uses to mount a `ToolUse` and to tell a pass-through from a drawn card; whether a test file may import `../hooks/cards`; whether `Button` press plus stored state works (the gate for Task 5).

- [ ] **Step 1: Write the scaffold.** Copy the shape of `codescout-redirect/.claude-plugin/plugin.json` (name, description, version `0.1.0`, author, license, keywords) and `hooks/hooks.json`. The stub is `export const register: Register = on => { on('ui.render', { component: 'ToolUse' }, ($, e, next) => next(e)).catch(($, e, next) => next(e)) }`.
- [ ] **Step 2: Validate.** Run `claude plugin validate codescout-display`. Expected: `Validation passed`. README and icon warnings are acceptable.
- [ ] **Step 3: Discover how a test mounts and reads a `ToolUse`.** Read `plugin-authoring/examples/menu.test.tsx` and the `claude-code/testing` types. Write one test in `tests/register.test.tsx` named `a mounted ToolUse passes through` that calls `$.ui.mount({ plugin: 'codescout-display', surface: 'terminal', component: 'ToolUse', props: <a full ToolUse props object> })`, then logs what `ui.find({})` and `ui.find({ type: 'Text' })` return. Run `claude plugin test codescout-display`. Record in the test file's header comment how an engine pass-through shows up, so Task 4 can assert it.
- [ ] **Step 4: Discover whether a test may import the plugin's own file.** Add `hooks/cards.ts` with `export const HEAD_LINES = 12`, and `tests/cards.test.ts` with a test `HEAD_LINES is 12` that imports it. Run `claude plugin test codescout-display`. If the import is refused, record that: Task 2 and 3 then test `buildCard` through `ui.mount` only, and `cards.ts` stays pure.
- [ ] **Step 5: The Button gate.** Read `plugin-authoring/examples/pane.tsx`, `pane-state.d.ts` and `reference.md` (the `atom`, `read` and `update` calls). In the stub hook, draw a `Button` that flips an `atom` keyed by `e.props.tool_use_id` and shows `open` or `closed`. Extend the mounted test: `ui.press({ key })` flips the text. Then load it live: `claude --plugin-dir codescout-display`, make one codescout call, and ask the person to press the control and report. Write the result as one line: `open control: works` or `open control: does not work in a ToolUse row`.
- [ ] **Step 6: Commit** the scaffold, the findings and the spec Results line.

```bash
git add codescout-display docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md
git commit -m "feat(codescout-display): scaffold, test kit findings and the open-control gate"
```

### Task 2: Reply parsing, folding and the generic summary

**Files:**
- Modify: `codescout-display/hooks/cards.ts`
- Test: `codescout-display/tests/cards.test.ts`

**Interfaces:**
- Produces, all exported from `cards.ts`:
  - `export const HEAD_LINES = 12`
  - `export function stripControl(s: string): string`
  - `export type Reply = { text: string; notes: string[] }`
  - `export function replyOf(output: unknown): Reply | undefined`: block 0's `text` and the `text` of every later block, all stripped; `undefined` when `output` is not an array with a text block 0.
  - `export function mainArg(input: unknown): string`: the first present of `path`, `pattern`, `name`, `command`, stripped, cut at 80 characters, else `''`.
  - `export type Fold = { head: string[]; hidden: number }`
  - `export function fold(text: string, max?: number): Fold`: a single trailing empty line is not a line; `max` defaults to `HEAD_LINES`.
  - `export function jsonFields(text: string): string | undefined`: `status: ok · replaced: 1` style, `·` between fields; `undefined` when `text` is not a JSON object with at least one scalar field.

- [ ] **Step 1: Write failing tests** in `tests/cards.test.ts`, named and asserting exactly:
  - `fold: 12 lines have no hidden`, `fold: 13 lines hide 1` (head length 12, `hidden` 1), `fold: a trailing newline is not a line` (`'a\nb\n'` gives head `['a','b']`, hidden 0), `fold: 5000 lines keep a 12-line head and hidden 4988`.
  - `stripControl removes ESC and NUL, keeps tab and newline`.
  - `replyOf: [] , a string, and a block with no text give undefined`; `replyOf: block 1 is a note` (`[{type:'text',text:'a'},{type:'text',text:'n'}]` gives `{ text: 'a', notes: ['n'] }`).
  - `mainArg: path wins over command; empty input gives ''; 200 characters are cut at 80`.
  - `jsonFields: {"status":"ok","replaced":1} gives 'status: ok · replaced: 1'`; `7 scalar fields give 6`; `a 60-character value is cut at 40`; `an array, a bare string and plain text give undefined`; `nested values are skipped`.
- [ ] **Step 2: Run** `claude plugin test codescout-display`. Expected: the new tests FAIL (functions not defined).
- [ ] **Step 3: Implement** the six functions with the signatures above. `fold` splits on `\n`, drops one trailing `''`, and slices.
- [ ] **Step 4: Run** `claude plugin test codescout-display`. Expected: PASS.
- [ ] **Step 5: Commit** `cards.ts` and `tests/cards.test.ts` as `feat(codescout-display): reply parsing and folding`.

### Task 3: Tool cards and `buildCard`

**Files:**
- Modify: `codescout-display/hooks/cards.ts`
- Test: `codescout-display/tests/cards.test.ts`

**Interfaces:**
- Consumes: Task 2's exports.
- Produces:
  - `export const LINE_CUT = 400`: no head line is longer than this many characters.
  - `export type Card = { title: string; body: { kind: 'text'; head: string[] } | { kind: 'fields'; line: string } | { kind: 'code'; source: string; path?: string; startLine?: number; isMarkdown: boolean } | { kind: 'diff'; source: string; path: string }; hidden: number; notes: string[]; full: string }`. `title` is `◆ <tool without the mcp__codescout__ prefix>  <mainArg>`. `full` is the whole stripped reply text.
  - `export type FileBody = { lines: string[]; startLine: number }` and `export function fileBody(text: string, input: unknown): FileBody | undefined`. It strips the `N lines` header and the one blank line after it (read how `codescout-redirect/hooks/register.ts` strips the same header, and mirror its rule). `startLine` is `input.start_line`, else `input.offset`, else 1. It returns `undefined` when the first line matches `/^\d+ lines +@file_/` (an outline) or no header is found.
  - `export function diffOf(oldText: string, newText: string): string`: one hunk, header `@@ -1,A +1,B @@`, then `-` lines, then `+` lines.
  - `export function editApplied(text: string): boolean`: true for the JSON string `"ok"` or a JSON object with `status: "ok"`.
  - `export function buildCard(tool: string, input: unknown, output: unknown): Card | undefined`: `undefined` when `replyOf` is `undefined`. `tool` is the full `mcp__codescout__…` name.

Dispatch: `read_file` with a `fileBody` gives a `code` card (`isMarkdown` for a `.md` path) of the first 12 lines; `edit_file` with string `old_string` and `new_string` (non-empty `old_string`) and `editApplied` gives a `diff` card; `create_file` whose reply passes `editApplied` and whose `input.content` is a string gives a `code` card of the first 12 lines of `content`; any other case, `jsonFields` gives a `fields` card; else a `text` card of `fold(text).head`.

- [ ] **Step 1: Write failing tests**, named and asserting exactly:
  - `read_file: header and blank line are stripped, gutter starts at start_line` (`'40 lines\n\nalpha\nbeta'`, `{ start_line: 7 }` gives `lines ['alpha','beta']`, `startLine 7`).
  - `read_file: an outline reply takes the generic text card` (`'103 lines  @file_0ad5\n\n# Title  L1'`).
  - `read_file: a .md path sets isMarkdown`.
  - `edit_file: an applied edit gives a diff with the old and new lines` (assert the `diffOf('a\nb','c')` text exactly: `@@ -1,2 +1,1 @@\n-a\n-b\n+c`).
  - `edit_file: a reply that is not ok takes the fields or text card, never a diff`; `edit_file: no old_string, or an empty one, takes the generic card`.
  - `create_file: status ok shows the head of content`.
  - `a 100000-character reply: the card holds at most 12 head lines and hidden is exact` (Review Focus 3); `a single 100000-character line is cut so no head line exceeds 400 characters`. Cut head lines at `LINE_CUT`.
  - `notes ride along: output with two blocks gives notes of length 1`.
- [ ] **Step 2: Run** `claude plugin test codescout-display`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions above. `buildCard` is one function with one branch per tool; the generic branch is the last.
- [ ] **Step 4: Run** `claude plugin test codescout-display`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(codescout-display): buildCard for read_file, edit_file, create_file and the generic card`.

### Task 4: The hook draws the card

**Files:**
- Modify: `codescout-display/hooks/register.tsx`
- Test: `codescout-display/tests/register.test.tsx`

**Interfaces:**
- Consumes: `buildCard`, `Card`, `HEAD_LINES` from `./cards`.
- Produces: the `ui.render` hook on `ToolUse`. A top-level `function drawCard(els: any, card: Card, isOpen: boolean): any` that takes the resolved elements (`Box`, `Text`, `Code`, `Markdown`), not `$`.

Drawing: a `Box` with `borderStyle="round"` and `borderColor` set to a theme key (use the Task 1 note on theme keys; fall back to `"cyan"`). Header `Text` bold. `text` body: one `Text` per head line, `wrap="truncate-end"`. `fields` body: one dim `Text`. `code` body: `Code` with `source`, `path`, `startLine`, or `Markdown` when `isMarkdown`. `diff` body: `Code` with `format="diff"` and `path`. When `hidden > 0`, a dim `… N more lines hidden`. Each note is one dim `Text` with `wrap="truncate-end"`.

- [ ] **Step 1: Write failing tests**, looped over `['terminal'] as const` like the plugin-authoring examples, using the mount and find calls found in Task 1:
  - Pass-through (each returns the engine node, asserted as Task 1 recorded): `a desktop surface`, `a non-codescout tool`, `a running row`, `an errored row`, `no output yet`, `isExpanded false`, `isExpanded absent`.
  - `a tree call draws a card: a header text starting with ◆ tree and 8 lines` and `a 40-line result draws 12 lines and "… 28 more lines hidden"`.
  - `an edit_file call that applied draws a Code with format diff`; `a read_file call draws a Code with the gutter start`.
  - `a thrown error in buildCard draws the engine row` (feed props that make `buildCard` throw; the `.catch` returns `next(e)`).
  - `an output with a hook note draws one dim note line` (Review Focus 1 is covered by `no output yet` and an `output: []` case; add `output: []`).
- [ ] **Step 2: Run** `claude plugin test codescout-display`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook: gate from Global Constraints, `buildCard(e.props.tool, e.props.input, e.props.output)`, `undefined` gives `next(e)`, else `drawCard($.ui.resolve(e), card, false)`. The `.catch` returns `next(e)`.
- [ ] **Step 4: Run** `claude plugin test codescout-display` and `claude plugin validate codescout-display`. Expected: PASS, `Validation passed`.
- [ ] **Step 5: Live check.** `claude --plugin-dir codescout-display`; run one `tree`, one `read_file`, one `edit_file` on a scratch file. Ask the person to confirm the three cards look right. Record the answer in the spec's Results.
- [ ] **Step 6: Commit** as `feat(codescout-display): the ToolUse hook draws cards`.

### Task 5: The open control (only if Task 1 recorded "works")

If Task 1 recorded `does not work in a ToolUse row`, skip this task, state in the README that the full text is not openable, and go to Task 6.

**Files:**
- Modify: `codescout-display/hooks/register.tsx`, `codescout-display/tests/register.test.tsx`; Create `codescout-display/types/index.d.ts` if Task 1's state calls need a contract (name it in `plugin.json` as `"types": "./types/index.d.ts"`).

**Interfaces:**
- Consumes: the state calls Task 1 verified; `Card.full` and `Card.notes`.
- Produces: a `Button` in the card when `hidden > 0` or `notes.length > 0`. Pressing it flips a flag keyed by `tool_use_id`. When open, the card draws `full` (in `Code`, or `Markdown`, as the body kind says) and the notes in full; the button reads `fold`. When closed it reads `open (N more lines)`.

- [ ] **Step 1: Write the failing tests**: `a long result draws an open button; pressing it draws the full text and 'fold'`; `pressing it again folds`; `two cards keep separate state`; `a result with nothing hidden and no notes draws no button`.
- [ ] **Step 2: Run** `claude plugin test codescout-display`. Expected: FAIL.
- [ ] **Step 3: Implement** the state and the button in `drawCard` via its `isOpen` parameter and the hook's state read. A state write redraws the readers.
- [ ] **Step 4: Run** tests and `claude plugin validate codescout-display`. Expected: PASS.
- [ ] **Step 5: Live check** as in Task 4, with a long `read_file`. Record the answer.
- [ ] **Step 6: Commit** as `feat(codescout-display): open and fold a card`.

### Task 6: Packaging, README and the repo test

**Files:**
- Create: `codescout-display/README.md`, `tests/test-codescout-display.sh`
- Modify: `.claude-plugin/marketplace.json`, `README.md`

- [ ] **Step 1: Write `tests/test-codescout-display.sh`** from `tests/test-codescout-redirect.sh`, dropping the guard-rules checks. It checks: `codescout-display/hooks/hooks.json` has only a `modules` key; `codescout-companion/hooks/hooks.json` has no `modules` key; `claude plugin test codescout-display` passes (skip with a SKIP line where `claude` is absent). It prints `Total`, `Pass`, `Fail` like its sibling.
- [ ] **Step 2: Run** `./tests/test-codescout-display.sh`. Expected: `Fail: 0`.
- [ ] **Step 3: Add the marketplace entry** after `codescout-redirect`'s, same shape: name `codescout-display`, source `./codescout-display`, description `Claude Code mod: draws each codescout tool call as one compact card in verbose mode, with a colored diff for edits and a fold for long results.`, author, license `MIT`, keywords `["codescout","mod","display","verbose"]`, category `infrastructure`. No `version` field. Run `./scripts/check-versions.sh` and `./tests/test-marketplace-validate.sh`. Expected: both pass.
- [ ] **Step 4: Add the root `README.md` table row** after `codescout-redirect`'s: `| **[codescout-display](./codescout-display/)** | 0.1.0 | Claude Code mod: draws each codescout tool call as one compact card in verbose mode, with a colored diff for edits and a fold for long results. Screen only: the model reads the same result. Design: \`docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md\`. |`. Run `./scripts/check-versions.sh`; if it checks the table, the version must match.
- [ ] **Step 5: Write `codescout-display/README.md`** (at least 40 words): what it does, the fold and the open control (or that it is not openable, per Task 1), the needs (Claude Code with hooks modules, MCP server named `codescout`, verbose mode), how to try it (`claude --plugin-dir codescout-display`), and the limits (terminal only; `edit_code` has no diff).
- [ ] **Step 6: Run** `./tests/run-all.sh`. Expected: no new failure. Where a failure also exists on `main` without these changes, report it and do not fix it here.
- [ ] **Step 7: Commit** each group with explicit paths: the plugin README, the repo test, the marketplace entry, the root README row.

Releasing (`release.sh codescout-display`) is a separate step after the person reviews the finished branch; the plan does not run it.
