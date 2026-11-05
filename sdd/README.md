# sdd: a strict spec-driven layer over superpowers

`sdd` adds gates to the superpowers flow, so that in a project that opts in, code follows an
approved spec and an approved plan, and a feature is reviewed before it reaches the base
branch. It does not replace superpowers or codescout; it is a thin layer on top of them.

## What it needs

- `codescout-companion`: the `spec-drift` skill, and the codescout MCP server it wraps.
- `superpowers`: brainstorming, writing-plans, subagent-driven-development and the rest.
- `codescout`: the document catalog (specs, plans, events) and the constitution tracker.

## Install

Install it in one Claude Code profile, with the two plugins above:

```
/plugin marketplace add mareurs/claude-plugins
/plugin install sdd@claude-plugins
```

Then, in the project:

```
/sdd-init
```

This writes `.sdd/config.json` (its presence turns the hooks on) and creates the constitution
tracker. It never commits.

## The flow

1. Design with `superpowers:brainstorming`; the design doc is the spec.
2. You type `/sdd:approve spec <feature>`.
3. Plan with `superpowers:writing-plans`.
4. You type `/sdd:approve plan <feature>`. Spec and plan are committed, then the worktree is made.
5. Execute with `superpowers:subagent-driven-development`. Source writes are denied until the
   plan is approved.
6. Check drift with `codescout-companion:spec-drift`.
7. `/review` checks the constitution and the drift verdict and writes a GO or NO-GO report.
8. You read the report and type `/sdd:approve review <feature>`.
9. Finish with `superpowers:finishing-a-development-branch`; you type `/sdd:approve done <feature>`.

Approval comes from you, not from the agent. The `approve-intake` hook reads the prompt you
type and writes the approval; the model cannot trigger it. The `sdd-flow` skill guides the
agent through these steps.

## Commands and skill

| Name | Purpose |
|---|---|
| `/sdd-init` | Config, constitution tracker, optional CLAUDE.md section |
| `/review` | Constitution and drift check; writes the GO or NO-GO report |
| `/sdd:approve` | Yours only: approve a spec, a plan or a review, or mark a feature done |
| `sdd-flow` (skill) | The nine-step guide for the agent |

## Hooks

| Hook | Event | Purpose |
|---|---|---|
| `spec-guard` | PreToolUse (writes) | Deny source writes without an active plan; deny any tool write of approval fields |
| `review-guard` | PreToolUse (shell) | Deny commits and merges on the base branch, pushes to it, and PR create or merge, until the review record exists |
| `approve-intake` | UserPromptSubmit | Turn your typed `/sdd:approve ...` into the approval |
| `session-start` | SessionStart | One banner: mode, active feature, next gate |
| `subagent-inject` | SubagentStart | Give subagents the active plan and spec paths |

`enforcement` in `.sdd/config.json` is `strict` (deny) or `warn` (note only).

## Known limits

The guards are not a sandbox.

- Shell writes (`sed -i`, `>`, `tee`) are not detected by `spec-guard`.
- An agent can write a go/go `report.json` itself, so your typed `/sdd:approve review` is the
  real gate: read the report before you type it.
- An agent can edit a plan's `branch:` field to widen its gate from the plan for this branch
  to any active plan.

## License

MIT
