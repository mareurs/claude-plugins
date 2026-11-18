
// build-context.mjs — turns Claude Code's UserPromptSubmit hook input into the
// neutral context the policy reads. Ids come only from the hook's own fields,
// never from prompt text. permission_mode, cwd and transcript_path are
// ignored in this version.

export function buildContext(hookInput) {
  const input =
    hookInput !== null && typeof hookInput === 'object' && !Array.isArray(hookInput)
      ? hookInput
      : {};
  const ctx = { prompt: typeof input.prompt === 'string' ? input.prompt : '' };
  if (typeof input.session_id === 'string') ctx.session_id = input.session_id;
  // prompt_id is the per-prompt id, so it is the turn id.
  if (typeof input.prompt_id === 'string') ctx.turn_id = input.prompt_id;
  ctx.harness = 'claude-code';
  ctx.signals = {};
  return ctx;
}
