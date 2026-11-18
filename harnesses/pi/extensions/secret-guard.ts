/**
 * secret-guard — deny-by-default egress gate for prompt-injected credential theft.
 *
 * Rebuilt here from scratch after two independent reviews found codescout PR #9's
 * implementation bypassable on 10 of 11 adversarial probes (see
 * docs/issues/archive/2026-08-08-build-secret-guard-fail-closed.md for the full analysis).
 * That version tried to detect *secrets* in the command text; every bypass was a gap
 * between its regex-over-text model and what curl/ssh/the shell actually do with the
 * bytes. This version inverts the trigger instead: it does not read or track secrets
 * at all. Any recognized egress utility must have every destination it parses out of
 * the command allowlisted, or the call is blocked — including when a destination
 * cannot be confidently parsed at all. Deny-by-default, restrictive on purpose.
 *
 * Six-step shape (see the design doc above for the full rationale):
 *   1. TOOL GATE      — bash/sh, MCP-prefixed *_run_command forms, plus configured extras.
 *   2. OVERRIDE       — out-of-band only: SECRET_GUARD_OVERRIDE=1 in the extension's own
 *                       process env. No in-command marker — a marker the model writes is a
 *                       marker the model can be talked into writing.
 *   3. EGRESS DETECT  — an egress binary at command position, per segment (split on
 *                       ; && || | newline, plus $(...) / `...` substitutions).
 *   4. DESTINATIONS   — parse every destination: schemed URLs (userinfo stripped before
 *                       taking the host, port/path stripped, [::1] handled) or, for a
 *                       known egress binary with no schemed URL, the first non-flag arg.
 *   5. FAIL CLOSED    — egress present AND (nothing parsed OR anything unallowlisted) => block.
 *   6. ALLOWLIST      — exact host match, or a leading "." for a domain + its subdomains.
 *
 * Honest limitations: this is defense in depth, not a sandbox. Exfiltration through an
 * already-allowlisted host is out of scope. `ssh some-host ...` is blocked until
 * `some-host` is allowlisted — that is the posture, not a bug: enumerate the hosts your
 * agent may talk to. Extend via `~/.pi/agent/secret-guard.json`:
 *   { "allowedHosts": ["internal.corp.example", ".corp.example"], "extraToolNames": ["shell"] }
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";

// Destinations considered legitimate for agent-initiated egress by default.
// Extend via the config file below rather than editing this list.
const DEFAULT_ALLOWED_HOSTS = [
	"api.kimi.com", "kimi.com", "www.kimi.com", "platform.kimi.ai",
	"api.moonshot.ai", "www.moonshot.ai",
	"github.com", "api.github.com", "raw.githubusercontent.com", "objects.githubusercontent.com",
	"registry.npmjs.org", "pypi.org", "files.pythonhosted.org", "crates.io", "static.crates.io",
	"api.search.brave.com",
	"localhost", "127.0.0.1", "::1",
];

// Egress binaries recognized at command position. Deliberately NOT bare-word
// matched anywhere in the string — see the PR #9 false-positive class this replaces.
const EGRESS_BINARIES = new Set(["curl", "wget", "nc", "ncat", "ssh", "scp", "sftp", "ftp", "telnet"]);

// Script one-liners that can perform HTTP egress without an EGRESS_BINARIES match.
const SCRIPT_HTTP =
	/\b(python3?|node|deno|bun)\b[^\n|;]*\s(-c|-e|--eval)\s[\s\S]*\b(urllib|requests|httpx|http\.client|fetch|axios|node:https?)\b/;

// Any schemed URL, destination text stops at the first quote/whitespace so a URL
// literal embedded in a quoted script argument (python -c "... 'https://x' ...") is
// still found without also swallowing the rest of the line.
const SCHEMED_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi;

const OVERRIDE_ENV = "SECRET_GUARD_OVERRIDE";

interface GuardConfig {
	allowedHosts: string[];
	extraToolNames: string[];
}

function agentDir(): string {
	return `${os.homedir()}/.pi/agent`;
}

function loadConfig(): GuardConfig {
	const cfg: GuardConfig = { allowedHosts: [], extraToolNames: [] };
	try {
		const raw = JSON.parse(fs.readFileSync(`${agentDir()}/secret-guard.json`, "utf-8"));
		if (Array.isArray(raw?.allowedHosts)) {
			cfg.allowedHosts = raw.allowedHosts.filter((h: unknown) => typeof h === "string");
		}
		if (Array.isArray(raw?.extraToolNames)) {
			cfg.extraToolNames = raw.extraToolNames.filter((t: unknown) => typeof t === "string");
		}
	} catch {
		// no config file — defaults are fine
	}
	return cfg;
}

// ── 1. TOOL GATE ─────────────────────────────────────────────────────────────
// A suffix/allowlist check, not equality: MCP tools register prefixed by server
// name (e.g. codescout's run_command surfaces as `codescout_run_command`), so a
// single `=== "bash"` check is the exact gap that made PR #9's tool substitution
// bypass (finding 5) work end to end against a prefixed shell tool.
function isShellTool(toolName: string, extraToolNames: string[]): boolean {
	if (toolName === "bash" || toolName === "sh" || toolName === "run_command") return true;
	if (toolName.endsWith("_bash") || toolName.endsWith("_sh") || toolName.endsWith("_run_command")) return true;
	return extraToolNames.includes(toolName);
}

// ── 3. EGRESS DETECT ─────────────────────────────────────────────────────────
function splitSegments(command: string): string[] {
	const top = command.split(/;|&&|\|\||\||\n/);
	const nested: string[] = [];
	for (const m of command.matchAll(/\$\(((?:[^()]|\([^()]*\))*)\)|`([^`]*)`/g)) {
		nested.push(m[1] ?? m[2] ?? "");
	}
	return [...top, ...nested].map((s) => s.trim()).filter(Boolean);
}

function firstToken(segment: string): string | undefined {
	const tokens = segment.split(/\s+/).filter(Boolean);
	let i = 0;
	// Skip leading VAR=value assignments to reach the actual command.
	while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
	return tokens[i];
}

interface EgressHit {
	segment: string;
	binary: string; // an EGRESS_BINARIES member, or "script-http"
}

function findEgress(command: string): EgressHit[] {
	const hits: EgressHit[] = [];
	for (const seg of splitSegments(command)) {
		const tok = firstToken(seg);
		const base = tok?.split("/").pop();
		if (base && EGRESS_BINARIES.has(base)) hits.push({ segment: seg, binary: base });
	}
	if (SCRIPT_HTTP.test(command)) hits.push({ segment: command, binary: "script-http" });
	return hits;
}

// ── 4. DESTINATIONS ──────────────────────────────────────────────────────────
function parseSchemedHost(url: string): string | undefined {
	const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
	if (!m) return undefined;
	let authority = m[1];
	const at = authority.lastIndexOf("@");
	if (at !== -1) authority = authority.slice(at + 1); // strip userinfo — PR #9 finding 1
	if (authority.startsWith("[")) {
		const end = authority.indexOf("]");
		return end === -1 ? undefined : authority.slice(0, end + 1).toLowerCase();
	}
	const colon = authority.indexOf(":");
	const host = colon === -1 ? authority : authority.slice(0, colon);
	return host ? host.toLowerCase() : undefined;
}

// Returns the parsed destination hosts for one egress hit. `null` in the result
// means "present but unparseable" — step 5 treats that as a block, not an allow.
function destinationsFor(hit: EgressHit): (string | null)[] {
	const schemed = [...hit.segment.matchAll(SCHEMED_URL)].map((m) => m[0]);
	if (schemed.length > 0) {
		return schemed.map((u) => parseSchemedHost(u) ?? null);
	}
	if (hit.binary === "script-http") return [null]; // egress confirmed, no URL literal found

	// Scheme-less: the first non-flag argument after the binary (user@host for ssh/scp
	// falls out of the same parse — strip userinfo, then port/path).
	const tokens = hit.segment.split(/\s+/).filter(Boolean);
	const bi = tokens.findIndex((t) => t.split("/").pop() === hit.binary);
	for (let i = bi + 1; i < tokens.length; i++) {
		const t = tokens[i];
		if (t.startsWith("-")) continue;
		const at = t.indexOf("@");
		const hostPart = at === -1 ? t : t.slice(at + 1);
		const host = hostPart.split(":")[0].split("/")[0].replace(/["']/g, "");
		return [host || null];
	}
	return [null]; // egress binary with no parseable argument at all
}

// ── 6. ALLOWLIST ──────────────────────────────────────────────────────────────
function isAllowedHost(host: string, allowedHosts: string[]): boolean {
	for (const allowed of allowedHosts) {
		if (allowed.startsWith(".")) {
			const domain = allowed.slice(1);
			if (host === domain || host.endsWith(`.${domain}`)) return true;
		} else if (host === allowed) {
			return true;
		}
	}
	return false;
}

export default function (pi: ExtensionAPI) {
	let allowedHosts: string[] = DEFAULT_ALLOWED_HOSTS;
	let extraToolNames: string[] = [];

	pi.on("session_start", async () => {
		const cfg = loadConfig();
		allowedHosts = [...DEFAULT_ALLOWED_HOSTS, ...cfg.allowedHosts];
		extraToolNames = cfg.extraToolNames;
	});

	pi.on("tool_call", async (event) => {
		if (!isShellTool(event.toolName, extraToolNames)) return undefined;

		// ── 2. OVERRIDE — out of band only. Not a command-string marker: see the
		// module doc for why an in-band marker is not a hard gate.
		if (process.env[OVERRIDE_ENV] === "1") return undefined;

		const command = ((event.input as { command?: string }).command) ?? "";
		const egressHits = findEgress(command);
		if (egressHits.length === 0) return undefined; // ── 5. FAIL CLOSED (no egress → nothing to check)

		const badHosts = new Set<string>();
		let unparsed = false;
		for (const hit of egressHits) {
			for (const dest of destinationsFor(hit)) {
				if (dest === null) { unparsed = true; continue; }
				if (!isAllowedHost(dest, allowedHosts)) badHosts.add(dest);
			}
		}

		if (unparsed || badHosts.size > 0) {
			const parts = [
				...(badHosts.size > 0 ? [`non-allowlisted host(s): ${[...badHosts].join(", ")}`] : []),
				...(unparsed ? ["a destination that could not be confidently parsed"] : []),
			];
			return {
				block: true,
				reason:
					`secret-guard: command performs network egress to ${parts.join(" and ")}. ` +
					`Allowlisted hosts: ${allowedHosts.join(", ")} ` +
					`(extend via ${agentDir()}/secret-guard.json). ` +
					`If intentional, get explicit user approval and re-run with ${OVERRIDE_ENV}=1 set ` +
					"in the agent process's own environment — not in the command.",
			};
		}
		return undefined;
	});
}
