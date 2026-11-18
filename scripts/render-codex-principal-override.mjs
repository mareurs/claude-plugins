// Read-only proposal renderer. Never reads or writes the user's Codex config.
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {pathToFileURL, fileURLToPath} from 'node:url';

const command = 'node ${CLAUDE_PLUGIN_ROOT}/hooks/principal-stamp.mjs';
const matcher = 'mcp__codescout__.*';

export function renderPrincipalStampOverride(registry, pluginId) {
  if (typeof pluginId !== 'string' || !/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/i.test(pluginId)) {
    throw new Error('Expected an explicit plugin-name@marketplace identifier.');
  }
  const groups = registry?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) throw new Error('Expected a PreToolUse registry.');
  const matches = [];
  for (const [groupIndex, group] of groups.entries()) {
    if (!Array.isArray(group?.hooks)) throw new Error('Expected hook handler arrays.');
    for (const [handlerIndex, handler] of group.hooks.entries()) {
      if (handler?.command === command && handler.type === 'command' && group.matcher === matcher) {
        matches.push([groupIndex, handlerIndex]);
      }
    }
  }
  if (matches.length !== 1) throw new Error('Expected exactly one recognized principal-stamp registration.');
  const [groupIndex, handlerIndex] = matches[0];
  const key = pluginId + ':hooks/hooks.json:pre_tool_use:' + groupIndex + ':' + handlerIndex;
  return '[hooks.state.' + JSON.stringify(key) + ']\nenabled = false\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values} = parseArgs({options: {
      'plugin-id': {type: 'string'}, hooks: {type: 'string'}, help: {type: 'boolean'}
    }});
    if (values.help) {
      process.stdout.write('Usage: node scripts/render-codex-principal-override.mjs --plugin-id name@marketplace [--hooks installed-plugin/hooks/hooks.json]\nPrints a proposal only; does not change Codex configuration.\n');
    } else {
      const path = values.hooks ?? fileURLToPath(new URL('../codescout-companion/hooks/hooks.json', import.meta.url));
      const registry = JSON.parse(readFileSync(path, 'utf8'));
      process.stdout.write(renderPrincipalStampOverride(registry, values['plugin-id']));
    }
  } catch {
    // Do not leak paths, supplied values, registry contents, or parse errors.
    process.stderr.write('Cannot render proposal: provide a valid plugin id and an unambiguous standard hooks/hooks.json registry. See --help.\n');
    process.exitCode = 1;
  }
}
