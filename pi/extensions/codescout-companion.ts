/**
 * pi-codescout-companion — skill tracking, recon badge, MCP status widget
 *
 * Shows a 3-line widget below the editor:
 *
 *   cs: reconnaissance                  [recon F2/W1]
 *   skills: research-web, pdf, docx
 *   MCP: 2/2  codescout ●  researcher ●
 *
 * Skill tracking: intercepts read tool calls on SKILL.md files + /skill: input.
 * Recon badge:    reads .buddy/<session_id>/recon-{loaded,active,counts.json}.
 * Session bridge: writes pi's session ID to .buddy/.current_session_id so
 *                 recon_count.py and the recon skill's bash snippets work unchanged.
 * MCP status:     inferred from pi.getAllTools() — no extra config needed.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

// Tools that read skill files. Covers built-in read + codescout variants.
const SKILL_READ_TOOLS = new Set([
  "read",
  "codescout_read_file",
  "codescout_read_markdown",
]);

// MCP servers to track. Each entry maps a display name to a tool name that is
// only registered when that server is connected. Edit to match your mcp.json.
const MCP_SERVERS: { name: string; indicatorTool: string }[] = [
  { name: "codescout",  indicatorTool: "codescout_grep" },
  { name: "researcher", indicatorTool: "researcher_research_run" },
];

const RECON_FRESH_SECS = 30 * 60;

export default function (pi: ExtensionAPI) {
  let loadedSkills: string[] = [];
  let sessionRoot: string | null = null;
  let sessionId:   string | null = null;
  let active = false;

  // ── skill helpers ──────────────────────────────────────────────────────────

  function skillIdFromPath(filePath: string): string | null {
    if (!filePath.endsWith("SKILL.md")) return null;
    const dir = path.basename(path.dirname(filePath));
    return filePath.includes("codescout-companion") ? `codescout-companion:${dir}` : dir;
  }

  function addSkill(id: string) {
    if (!loadedSkills.includes(id)) loadedSkills.push(id);
  }

  function shortName(id: string) { return id.split(":").pop() ?? id; }

  function formatLine(ids: string[], label: string): string {
    if (!ids.length) return "";
    const shorts = ids.map(shortName);
    const ri = shorts.indexOf("reconnaissance");
    if (ri > 0) { shorts.splice(ri, 1); shorts.unshift("reconnaissance"); }
    const cap = 12;
    return `${label}: ${shorts.slice(0, cap).join(", ")}${shorts.length > cap ? " …" : ""}`;
  }

  function partitionSkills() {
    const cs: string[] = [], other: string[] = [];
    for (const id of loadedSkills)
      (id.split(":")[0].startsWith("codescout") ? cs : other).push(id);
    return { cs, other };
  }

  // ── recon badge ────────────────────────────────────────────────────────────

  function reconBadge(theme: any): string {
    if (!sessionRoot || !sessionId) return "";
    const dir = path.join(sessionRoot, ".buddy", sessionId);
    const now = Math.floor(Date.now() / 1000);

    let activeFresh = false;
    try {
      const stat = fs.statSync(path.join(dir, "recon-active"));
      activeFresh = now - Math.floor(stat.mtimeMs / 1000) <= RECON_FRESH_SECS;
    } catch {}

    const loaded = fs.existsSync(path.join(dir, "recon-loaded"));
    if (!activeFresh && !loaded) return "";

    let suffix = "";
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, "recon-counts.json"), "utf-8"));
      const f = parseInt(String(d.F ?? 0), 10);
      const w = parseInt(String(d.W ?? 0), 10);
      const parts = [...(f > 0 ? [`F${f}`] : []), ...(w > 0 ? [`W${w}`] : [])];
      if (parts.length) suffix = ` ${parts.join("/")}`;
    } catch {}

    return activeFresh
      ? theme.fg("accent", `[recon•${suffix}]`)
      : theme.fg("muted",  `[recon${suffix}]`);
  }

  // ── MCP status ─────────────────────────────────────────────────────────────

  function mcpLine(theme: any): string {
    if (!MCP_SERVERS.length) return "";
    const toolNames = new Set(pi.getAllTools().map((t) => t.name));
    const connected = MCP_SERVERS.filter((s) => toolNames.has(s.indicatorTool)).length;
    const count = theme.fg("dim", `MCP: ${connected}/${MCP_SERVERS.length}  `);
    const servers = MCP_SERVERS.map((s) => {
      const up = toolNames.has(s.indicatorTool);
      return theme.fg("dim", s.name) + " " + (up ? theme.fg("success", "●") : theme.fg("muted", "○"));
    }).join(theme.fg("dim", "  "));
    return count + servers;
  }

  // ── widget ─────────────────────────────────────────────────────────────────

  function updateWidget(ctx: ExtensionContext) {
    const { cs, other } = partitionSkills();
    const csLine  = formatLine(cs,    "cs");
    const sklLine = formatLine(other, "skills");
    const theme   = ctx.ui.theme;
    const badge   = reconBadge(theme);
    const mcp     = mcpLine(theme);

    if (!csLine && !sklLine && !badge && !mcp) {
      ctx.ui.setWidget("companion-status", undefined, { placement: "belowEditor" });
      return;
    }

    ctx.ui.setWidget("companion-status", (_tui, theme) => {
      const lines: string[] = [];

      if (csLine || badge) {
        lines.push(
          (csLine ? theme.fg("dim", csLine) : "") +
          (csLine && badge ? "   " : "") +
          badge,
        );
      }
      if (sklLine) lines.push(theme.fg("dim", sklLine));
      if (mcp)     lines.push(mcpLine(theme));

      return new Text(lines.join("\n"), 0, 0);
    }, { placement: "belowEditor" });
  }

  // ── session bridge ─────────────────────────────────────────────────────────

  function getSessionId(ctx: ExtensionContext): string | null {
    const file = ctx.sessionManager.getSessionFile();
    return file ? path.basename(file, ".jsonl") : null;
  }

  function writeSessionIdBridge(root: string, sid: string) {
    try {
      fs.mkdirSync(path.join(root, ".buddy"), { recursive: true });
      fs.writeFileSync(path.join(root, ".buddy", ".current_session_id"), sid);
    } catch {}
  }

  // ── history scan ───────────────────────────────────────────────────────────

  function scanHistory(ctx: ExtensionContext) {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "assistant") continue;
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== "toolCall" || !SKILL_READ_TOOLS.has(block.name)) continue;
        const p = (block.arguments?.path ?? block.arguments?.file_path) as string | undefined;
        if (p) { const id = skillIdFromPath(p); if (id) addSkill(id); }
      }
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    active = true;
    loadedSkills = [];
    sessionRoot  = ctx.cwd;
    sessionId    = getSessionId(ctx);
    if (sessionRoot && sessionId) writeSessionIdBridge(sessionRoot, sessionId);
    scanHistory(ctx);
    updateWidget(ctx);
  });

  pi.on("session_shutdown", async () => { active = false; });

  pi.on("session_tree", async (_event, ctx) => {
    loadedSkills = [];
    scanHistory(ctx);
    updateWidget(ctx);
  });

  // ── skill tracking ─────────────────────────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (!active || !SKILL_READ_TOOLS.has(event.toolName)) return;
    const inp = event.input as Record<string, unknown>;
    const p = (inp.path ?? inp.file_path) as string | undefined;
    if (!p) return;
    const id = skillIdFromPath(p);
    if (!id) return;
    addSkill(id);
    updateWidget(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (!active) return;
    const m = event.text.match(/^\/skill:([a-z0-9_:.-]+)/i);
    if (!m) return;
    addSkill(m[1]);
    updateWidget(ctx);
  });

  // ── recon + MCP refresh ────────────────────────────────────────────────────

  pi.on("turn_end",    async (_event, ctx) => { if (active) updateWidget(ctx); });
  pi.on("agent_start", async (_event, ctx) => { if (active) updateWidget(ctx); });
}
