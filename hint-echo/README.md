# hint-echo

A Claude Code mod that shows you what tool hooks tell the model.

A hook such as the buddy `[cs-hint]` advisory hands text to the model through
`hookSpecificOutput.additionalContext`. Claude Code does not show that text to
the user. This mod hooks `classic.PreToolUse`, `classic.PostToolUse` and
`classic.PostToolUseFailure`, calls `next(e)`, and writes each `additionalContext`
entry as a dim transcript row with `$.ui.log`. The rows read
`hook told the model after <tool>: <text>`. Text over 400 characters is cut.

The mod only reads. It always returns what `next(e)` returned, so the model
receives the same context with or without it. It does not echo `SessionStart`
blocks, which are several kilobytes each.

Needs a Claude Code build with hooks modules (`hooks/hooks.json` with `modules`).
Not verified on other builds. Check it with `claude plugin validate hint-echo`.
