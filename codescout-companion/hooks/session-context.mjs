import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const fields = ['schema_version', 'harness', 'session_id', 'agent_id', 'workspace', 'source', 'harness_version'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const failure = (state, reason) => ({ state, context: null, reason });
const canonical = path => realpathSync(resolve(path));

/** Validate context against the consumer's independently resolved checkout. */
export function validateContext(value, workspace) {
  if (!object(value)) return failure('unsupported', 'context must be an object');
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) return failure('unsupported', `missing context field ${field}`);
  }
  if (value.schema_version !== 1) return failure('unsupported', 'unsupported schema_version');
  if (!['claude-code', 'codex', 'manual'].includes(value.harness)) return failure('unsupported', 'unsupported harness');
  if (!['native-hook', 'native-env', 'explicit'].includes(value.source)) return failure('unsupported', 'unsupported source');
  if (!nonempty(value.session_id)) return failure('unsupported', 'session_id must be a nonempty string');
  if (value.agent_id !== null && !nonempty(value.agent_id)) return failure('unsupported', 'agent_id must be null or a nonempty string');
  if (value.harness_version !== null && !nonempty(value.harness_version)) return failure('unsupported', 'harness_version must be null or a nonempty string');
  if (!nonempty(value.workspace) || !isAbsolute(value.workspace)) return failure('unsupported', 'workspace must be absolute');
  try {
    if (canonical(value.workspace) !== canonical(workspace)) return failure('conflicting', 'context workspace differs from invocation checkout');
    const context = Object.fromEntries(fields.map(field => [field, value[field]]));
    context.workspace = canonical(workspace);
    context.schema_version = 1;
    return { state: 'available', context, reason: '' };
  } catch {
    return failure('unsupported', 'workspace cannot be resolved');
  }
}

/** Origin is explicit; similar native payloads never identify a host. */
export function normalizeHookContext(harness, input, workspace, harnessVersion = null) {
  if (!['claude-code', 'codex'].includes(harness)) return failure('unsupported', 'hook adapter origin must be explicit');
  if (!object(input)) return failure('unsupported', 'native payload must be an object');
  if (input.session_id === undefined || input.session_id === '') return failure('missing', 'native session_id is missing');
  if (!nonempty(input.session_id)) return failure('unsupported', 'native session_id must be a nonempty string');
  if (!nonempty(input.cwd) || !isAbsolute(input.cwd)) return failure('unsupported', 'native cwd must be absolute');
  try {
    const rel = relative(canonical(workspace), canonical(input.cwd));
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return failure('conflicting', 'native cwd is outside invocation checkout');
  } catch {
    return failure('unsupported', 'native cwd cannot be resolved');
  }
  return validateContext({
    schema_version: 1, harness, session_id: input.session_id,
    agent_id: input.agent_id ?? null, workspace,
    source: 'native-hook', harness_version: harnessVersion,
  }, workspace);
}
