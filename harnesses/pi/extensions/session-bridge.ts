import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Pi session bridge — list local Pi sessions and ask a read-only snapshot.
 *
 * This intentionally does not offer a bidirectional mode. Pi does not expose a
 * supported API for appending to an arbitrary already-running session; writing
 * another process's JSONL session file would race Pi and bypass user consent.
 */

type SessionEntry = {
  id: string;
  sessionFile: string;
  sessionDir: string;
  cwd: string;
  branch: string | null;
  pid: number;
  procStart: string | null;
  startedAt: number;
  updatedAt: number;
  alias: string | null;
  client: "pi";
};

type Registry = { version: 2; sessions: Record<string, SessionEntry> };

const REGISTRY_VERSION = 2 as const;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;
const READ_ONLY_TOOLS = "read,grep,find,ls";
const OUTPUT_LIMIT = 64 * 1024;

function bridgeDir(): string {
  return path.join(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"), "session-bridge");
}

function registryPath(): string { return path.join(bridgeDir(), "active.json"); }
function lockPath(): string { return path.join(bridgeDir(), ".lock"); }

function emptyRegistry(): Registry { return { version: REGISTRY_VERSION, sessions: {} }; }

function currentProcStart(pid: number): string | null {
  try {
    // Field 22 follows the final ')' in /proc/<pid>/stat. Keeping it with the
    // PID prevents a reused PID from being treated as the old session.
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

function isLive(entry: SessionEntry): boolean {
  // A live PID alone is insufficient: a session can end while its PID is
  // reused, or its session file can be deleted independently. Neither record
  // is askable, so prune it before presenting the registry as live sessions.
  if (!sessionFileIsSafe(entry) || !fs.existsSync(entry.sessionFile)) return false;
  try {
    process.kill(entry.pid, 0);
  } catch {
    return false;
  }
  return !entry.procStart || currentProcStart(entry.pid) === entry.procStart;
}

function sessionFileIsSafe(entry: SessionEntry): boolean {
  const root = path.resolve(entry.sessionDir);
  const file = path.resolve(entry.sessionFile);
  return file.startsWith(`${root}${path.sep}`) && path.extname(file) === ".jsonl";
}

function currentBranch(cwd: string): string | null {
  try {
    const head = path.join(cwd, ".git", "HEAD");
    const value = fs.readFileSync(head, "utf8").trim();
    return value.startsWith("ref: refs/heads/") ? value.slice("ref: refs/heads/".length) : null;
  } catch {
    return null;
  }
}

async function withLock<T>(operation: () => Promise<T>): Promise<T> {
  fs.mkdirSync(bridgeDir(), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 2_000;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = fs.openSync(lockPath(), "wx", 0o600);
    } catch (error: any) {
      if (error?.code !== "EEXIST" || Date.now() >= deadline) throw new Error("session bridge registry is busy; retry");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await operation();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockPath(), { force: true });
  }
}

function readRegistry(): Registry {
  try {
    const value = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    if (value?.version !== REGISTRY_VERSION || !value.sessions || typeof value.sessions !== "object") {
      throw new Error("unsupported registry schema");
    }
    return value as Registry;
  } catch (error: any) {
    if (error?.code === "ENOENT") return emptyRegistry();
    throw new Error(`session bridge registry is corrupt: ${error.message}`);
  }
}

function writeRegistry(registry: Registry): void {
  const target = registryPath();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

async function updateRegistry(mutator: (registry: Registry) => void): Promise<Registry> {
  return withLock(async () => {
    const registry = readRegistry();
    for (const [id, entry] of Object.entries(registry.sessions)) if (!isLive(entry)) delete registry.sessions[id];
    mutator(registry);
    writeRegistry(registry);
    return registry;
  });
}

function resolveRef(registry: Registry, ref: string): SessionEntry {
  if (registry.sessions[ref]) return registry.sessions[ref];
  const matches = Object.values(registry.sessions).filter((entry) =>
    entry.id.startsWith(ref) || entry.alias === ref || !!entry.alias?.includes(ref) || entry.cwd.includes(ref),
  );
  if (!matches.length) throw new Error(`no active Pi session matches '${ref}'`);
  if (matches.length > 1) throw new Error(`session reference '${ref}' is ambiguous: ${matches.map((entry) => entry.id).join(", ")}`);
  return matches[0];
}

async function runSnapshot(entry: SessionEntry, prompt: string, timeoutS: number, signal: AbortSignal): Promise<string> {
  if (!sessionFileIsSafe(entry)) throw new Error("registered session path is outside its session directory");
  if (!fs.existsSync(entry.sessionFile)) throw new Error("registered session file no longer exists");

  const childDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-bridge-"));
  fs.chmodSync(childDir, 0o700);
  const executable = process.env.PI_SESSION_BRIDGE_PI_BIN ?? "pi";
  const args = ["-p", "--session-dir", childDir, "--fork", entry.sessionFile, "--no-extensions", "--tools", READ_ONLY_TOOLS, "--", prompt];

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, args, { cwd: entry.cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        const text = chunk.toString();
        if (target === "stdout") stdout = (stdout + text).slice(-OUTPUT_LIMIT);
        else stderr = (stderr + text).slice(-OUTPUT_LIMIT);
      };
      child.stdout.on("data", (chunk) => append("stdout", chunk));
      child.stderr.on("data", (chunk) => append("stderr", chunk));
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutS * 1_000);
      const abort = () => child.kill("SIGTERM");
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (signal.aborted) return reject(new Error("snapshot ask cancelled"));
        if (code !== 0) return reject(new Error(`Pi snapshot failed (exit ${code}): ${(stderr || stdout).trim()}`));
        resolve(stdout.trim());
      });
    });
  } finally {
    fs.rmSync(childDir, { recursive: true, force: true });
  }
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export default function (pi: ExtensionAPI) {
  let registered: Pick<SessionEntry, "id" | "pid"> | null = null;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.sessionManager.isPersisted()) return;
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;
    const entry: SessionEntry = {
      id: ctx.sessionManager.getSessionId(), sessionFile, sessionDir: ctx.sessionManager.getSessionDir(),
      cwd: ctx.cwd, branch: currentBranch(ctx.cwd), pid: process.pid, procStart: currentProcStart(process.pid),
      startedAt: Date.now(), updatedAt: Date.now(), alias: null, client: "pi",
    };
    await updateRegistry((registry) => {
      const old = registry.sessions[entry.id];
      registry.sessions[entry.id] = { ...entry, alias: old?.alias ?? null, startedAt: old?.startedAt ?? entry.startedAt };
    });
    registered = { id: entry.id, pid: entry.pid };
  });

  pi.on("session_shutdown", async () => {
    if (!registered) return;
    const mine = registered;
    await updateRegistry((registry) => {
      if (registry.sessions[mine.id]?.pid === mine.pid) delete registry.sessions[mine.id];
    });
    registered = null;
  });

  pi.registerTool({
    name: "session_bridge_list", label: "List Pi sessions",
    description: "List locally active Pi sessions registered by the session bridge.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, _ctx) {
      const registry = await updateRegistry(() => {});
      const sessions = Object.values(registry.sessions).map(({ sessionFile: _file, sessionDir: _dir, procStart: _start, ...safe }) => safe);
      return textResult(JSON.stringify({ scope: "local machine; Pi sessions registered by this extension", sessions }, null, 2), { sessions });
    },
  });

  pi.registerTool({
    name: "session_bridge_ask", label: "Ask Pi session snapshot",
    description: "Ask a read-only snapshot of a registered local Pi session. The producer is never modified; answers may exclude its latest unsaved turn.",
    parameters: Type.Object({
      ref: Type.String({ description: "Exact session ID, ID prefix, alias, or unique cwd substring." }),
      prompt: Type.String({ description: "Question for the snapshot session." }),
      timeout_s: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_S, description: "Timeout in seconds (default 120)." })),
    }),
    async execute(_id, params, signal, _update, _ctx) {
      const registry = await updateRegistry(() => {});
      const entry = resolveRef(registry, params.ref);
      const started = Date.now();
      const answer = await runSnapshot(entry, params.prompt, params.timeout_s ?? DEFAULT_TIMEOUT_S, signal);
      return textResult(answer, { mode: "snapshot", source_session_id: entry.id, duration_ms: Date.now() - started });
    },
  });

  pi.registerTool({
    name: "session_bridge_set_alias", label: "Set Pi session alias",
    description: "Set or clear a friendly alias for a registered local Pi session.",
    parameters: Type.Object({
      session_id: Type.String({ description: "Exact registered session ID." }),
      alias: Type.Optional(Type.String({ minLength: 1, description: "Friendly alias; omit to clear." })),
    }),
    async execute(_id, params, _signal, _update, _ctx) {
      await updateRegistry((registry) => {
        const entry = registry.sessions[params.session_id];
        if (!entry) throw new Error(`no active Pi session has ID '${params.session_id}'`);
        entry.alias = params.alias ?? null;
        entry.updatedAt = Date.now();
      });
      return textResult("ok");
    },
  });
}
