// Pure rules of pre-tool-guard.mjs: which native calls the guard lets through.
//
// No `node:` import and no process or file access, so the same file can be imported
// by a Claude Code mod (a hooks module has no Node). The caller passes the environment in.
// The guard keeps everything with state or text: the breaker, the strike window, the messages.
//
// The guard denies every call to Bash, Grep, Glob, Read, Edit and Write except the ones below.
// A source-file extension never exempts a call; it only picks the wording of the deny.

// Windows backslash paths become forward slashes, so every check below can be written with `/`.
export const norm = (p) => (p || '').replace(/\\/g, '/');

export const isBinaryImage = (p) => /\.(png|jpg|jpeg|gif|webp|bmp|ico|pdf)$/i.test(p);

export function isSkillPayload(p) {
  if (/\/plugins\/cache\//.test(p)) return true; // installed plugin payloads, any profile
  if (/\/\.buddy\//.test(p)) return true; // buddy global + project trees
  return /(^|\/)skills\/[^/]+\/(SKILL\.md|_[^/]+\.md|references\/[^/]+)$/.test(p);
}

export const isHarnessOutput = (p) => /\/tool-results\//.test(p);

// `env.home` is the normalized home directory; `env.configDir` is CLAUDE_CONFIG_DIR as set ('' when unset).
export function isConfigDir(p, env) {
  const { home, configDir } = env;
  if (p.startsWith(`${home}/.claude/`) || p.startsWith(`${home}/.claude-`)) return true;
  if (configDir && p.startsWith(`${norm(configDir)}/`)) return true;
  return false;
}

// Codescout cannot express the host's native sandbox approval request, so the guard leaves that call
// to the host. This is advisory context, not an allow.
export const isSandboxEscalation = (toolInput) => toolInput?.sandbox_permissions === 'require_escalated';

export const GUARDED_TOOLS = ['Bash', 'Grep', 'Glob', 'Read', 'Edit', 'Write'];

// Why the guard lets this call through, or null when it denies it.
// `target` is what the tool names: the file path for Read, Edit and Write, `path` for Grep, `pattern`
// for Glob. It must already be normalized with `norm`. A tool the guard has no branch for is
// 'unguarded-tool'. Bash is never exempt here: see isSandboxEscalation.
export function exemptReason(tool, target, env) {
  if (!GUARDED_TOOLS.includes(tool)) return 'unguarded-tool';
  switch (tool) {
    case 'Read':
      if (isBinaryImage(target)) return 'image';
      if (isSkillPayload(target)) return 'skill-payload';
      if (isHarnessOutput(target)) return 'harness-output';
      if (isConfigDir(target, env)) return 'config-dir';
      return null;
    case 'Edit':
    case 'Write':
      return isBinaryImage(target) ? 'image' : null;
    case 'Grep':
    case 'Glob':
      return isConfigDir(target, env) ? 'config-dir' : null;
    default:
      return null;
  }
}
