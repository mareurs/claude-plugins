// codescout-companion/hooks/detect.mjs
// JS port of scripts/detect.py — the codescout detection foundation shared by the
// Node hooks. Node-only (no Python needed on Windows). Kept byte-parity with
// detect.py (compared via --json) by hooks/detect.test.sh.
//
// Parity caveat: Python json.dump defaults to ensure_ascii=True; JSON.stringify
// emits UTF-8. Parity holds for ASCII values (which the tests use); non-ASCII
// system-prompt/memory content would diverge in escaping only.
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_EXT_PATTERN =
  '\\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp|sh|bash)$';
const SERVER_NAME_RE = /codescout/;

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function loadJson(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function expandHome(value, home) {
  if (value.startsWith('~/')) return `${home}${value.slice(1)}`;
  if (value === '~') return home;
  return value;
}

function findRoutingConfig(cwd) {
  const candidates = [
    join(cwd, '.claude', 'codescout-companion.json'),
    join(cwd, '.claude', 'codescout-routing.json'),
  ];
  for (const p of candidates) if (isFile(p)) return p;
  return null;
}

function serverNameFromMcpConfig(cfg) {
  const servers = cfg.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return '';
  for (const [key, value] of Object.entries(servers)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const cmd = value.command || '';
    if (typeof cmd === 'string' && SERVER_NAME_RE.test(cmd)) return key;
    const args = value.args || [];
    if (Array.isArray(args) && args.some((a) => typeof a === 'string' && SERVER_NAME_RE.test(a))) {
      return key;
    }
  }
  return '';
}

function extractCommand(cfg, serverName) {
  const servers = cfg.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return '';
  const entry = servers[serverName];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const cmd = entry.command || '';
  return typeof cmd === 'string' ? cmd : '';
}

export function detect(cwd, home, claudeConfigDir) {
  const projectDir = join(cwd, '.codescout');
  const memoriesDir = join(projectDir, 'memories');
  const configFile = join(projectDir, 'project.toml');
  const systemPromptFile = join(projectDir, 'system-prompt.md');
  const mcpJson = join(cwd, '.mcp.json');

  const routingPath = findRoutingConfig(cwd);
  let hasCodescout = false;
  let serverName = '';

  let routingCfg = {};
  if (routingPath) {
    routingCfg = loadJson(routingPath) || {};
    const override = routingCfg.server_name;
    if (typeof override === 'string' && override) {
      hasCodescout = true;
      serverName = override;
    }
  }

  if (!hasCodescout && isFile(mcpJson)) {
    const cfg = loadJson(mcpJson);
    if (cfg) {
      const name = serverNameFromMcpConfig(cfg);
      if (name) {
        hasCodescout = true;
        serverName = name;
      }
    }
  }

  const claudeDir = claudeConfigDir ? claudeConfigDir : join(home, '.claude');
  const userConfigs = [join(claudeDir, '.claude.json'), join(claudeDir, 'settings.json')];
  if (!claudeConfigDir) userConfigs.push(join(home, '.claude.json'));

  if (!hasCodescout) {
    for (const cfgPath of userConfigs) {
      if (!isFile(cfgPath)) continue;
      const cfg = loadJson(cfgPath);
      if (!cfg) continue;
      const name = serverNameFromMcpConfig(cfg);
      if (name) {
        hasCodescout = true;
        serverName = name;
        break;
      }
    }
  }

  const prefix = hasCodescout ? `mcp__${serverName}__` : '';

  let binary = '';
  if (hasCodescout && serverName) {
    const binarySearch = [
      mcpJson,
      join(claudeDir, '.claude.json'),
      join(claudeDir, 'settings.json'),
      join(home, '.claude.json'),
    ];
    for (const cfgPath of binarySearch) {
      if (!isFile(cfgPath)) continue;
      const cfg = loadJson(cfgPath);
      if (!cfg) continue;
      const cmd = extractCommand(cfg, serverName);
      if (cmd) {
        binary = expandHome(cmd, home);
        break;
      }
    }
  }

  let blockReads = 'true';
  let workspaceRoot = '';
  if (routingCfg && Object.keys(routingCfg).length) {
    const blockVal = routingCfg.block_reads;
    if (blockVal === false || blockVal === 'false') blockReads = 'false';
    const ws = routingCfg.workspace_root;
    if (typeof ws === 'string' && ws) workspaceRoot = expandHome(ws, home);
  }

  const hasOnboarding = isFile(configFile) ? 'true' : 'false';

  let hasMemories = 'false';
  let memoryNames = '';
  if (isDir(memoriesDir)) {
    // Recurses, because a memory topic is a PATH. The server's authority is
    // MemoryStore::list (codescout src/memory/mod.rs:114): it walks with walkdir at
    // arbitrary depth and names each topic by its path relative to the memories dir,
    // extension stripped, separators normalised to '/'. That string is the topic key —
    // memory(action="read", topic="infra/friction-measurement") — so a shallower scan
    // here does not merely under-report, it makes those topics unreachable through
    // every surface fed by CS_MEMORY_NAMES: the SessionStart banner, and the subagent
    // Phase 0 block, which substitutes this list FOR the memory(action="list") call.
    // docs/issues/archive/2026-08-27-cs-memory-names-skips-namespaced-memories.md
    //
    // withFileTypes, not statSync: Dirent's isFile()/isDirectory() are lstat-based and
    // BOTH false for a symlink, which reproduces walkdir's no-follow default and makes
    // a symlink cycle under memories/ unable to hang this hook. statSync follows links,
    // so the obvious recursion written with the isFile/isDir helpers above can loop —
    // and this runs at SessionStart, where a hang costs the whole session.
    const walk = (dir, prefix) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        // fail-open PER DIRECTORY: one unreadable subdirectory hides itself, never its
        // siblings. The pre-recursion version wrapped the whole scan, so a single
        // failure reported zero memories.
        return;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        const name = e.name;
        // name.length > 3 excludes a file literally named ".md" (parity with
        // detect.py, where Path(".md").suffix == "" so it is not a memory).
        if (e.isFile() && name.endsWith('.md') && name.length > 3) {
          memoryNames += `${prefix}${name.slice(0, -3)} `;
          hasMemories = 'true';
        } else if (e.isDirectory()) {
          walk(join(dir, name), `${prefix}${name}/`);
        }
      }
    };
    walk(memoriesDir, '');
  }

  let hasSystemPrompt = 'false';
  let systemPrompt = '';
  if (isFile(systemPromptFile)) {
    try {
      systemPrompt = readFileSync(systemPromptFile, 'utf8');
      hasSystemPrompt = 'true';
    } catch {
      /* fail-open */
    }
  }

  return {
    HAS_CODESCOUT: hasCodescout ? 'true' : 'false',
    CS_SERVER_NAME: serverName,
    CS_PREFIX: prefix,
    CS_BINARY: binary,
    CS_PROJECT_DIR: projectDir,
    CS_MEMORIES_DIR: memoriesDir,
    CS_CONFIG_FILE: configFile,
    ROUTING_CONFIG: routingPath || '',
    HAS_CS_ONBOARDING: hasOnboarding,
    HAS_CS_MEMORIES: hasMemories,
    CS_MEMORY_NAMES: memoryNames,
    HAS_CS_SYSTEM_PROMPT: hasSystemPrompt,
    CS_SYSTEM_PROMPT: systemPrompt,
    BLOCK_READS: blockReads,
    WORKSPACE_ROOT: workspaceRoot,
    SOURCE_EXT_PATTERN: SOURCE_EXT_PATTERN,
  };
}

// CLI (parity testing only): `CWD=... node detect.mjs --json`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cwd = process.env.CWD || '';
  const home = process.env.HOME || '';
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || null;
  if (!cwd) {
    process.stderr.write('CWD must be set in env\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(detect(cwd, home, claudeConfigDir), null, 2) + '\n');
}
