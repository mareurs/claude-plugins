import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EDIT_TOOLS = ["codescout_edit_code", "codescout_edit_file", "codescout_edit_markdown"];
const WRITE_TOOL = "codescout_create_file";
const READ_TOOL = "codescout_read_file";
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
const RG_AG = /(^|\s|\|)(rg|ag)\b/;
const FIND_NAME = /(^|\s|\|)find\s+\S+(?:\s+\S+)*\s+-name\b/;
const SOURCE_DUMP = /(^|\s|\|)(cat|head|tail|sed|awk)\s+/;
const SOURCE_EXT = /\.(rs|py|ts|tsx|js|jsx|go|java|kt|kts|c|cc|cpp|h|hpp|rb|php|swift|scala|cs)\b/;
const OVERRIDE_MARKER = /#\s*codescout-override\b/;

function isRecursiveGrep(command: string): boolean {
  for (const segment of command.split("|")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] !== "grep") continue;
    for (const token of tokens.slice(1)) {
      if (token === "--recursive" || token === "-r" || token === "-R") return true;
      if (/^-[a-zA-Z]+$/.test(token) && /[rR]/.test(token.slice(1))) return true;
    }
  }
  return false;
}

function isRedundantBashCommand(command: string): boolean {
  if (OVERRIDE_MARKER.test(command)) return false;
  return RG_AG.test(command) || isRecursiveGrep(command) || FIND_NAME.test(command) ||
    (SOURCE_DUMP.test(command) && SOURCE_EXT.test(command));
}

export default function codescoutMode(pi: ExtensionAPI) {
  const has = (name: string) => pi.getAllTools().some((tool) => tool.name === name);
  const hasAll = (names: string[]) => names.every(has);

  pi.on("session_start", async (_event, context) => {
    const dropEdit = hasAll(EDIT_TOOLS);
    const dropWrite = has(WRITE_TOOL);
    if (!dropEdit && !dropWrite) return;

    const activeTools = new Set(pi.getActiveTools());
    if (dropEdit) activeTools.delete("edit");
    if (dropWrite) activeTools.delete("write");

    try {
      await pi.setActiveTools([...activeTools]);
    } catch (error) {
      if (context.hasUI) context.ui.notify(`codescout-mode: setActiveTools failed (${String(error)})`, "info");
    }
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName === "edit" && hasAll(EDIT_TOOLS)) {
      return { block: true, reason: "Use codescout's edit_code, edit_file, or edit_markdown instead of native edit." };
    }
    if (event.toolName === "write" && has(WRITE_TOOL)) {
      return { block: true, reason: "Use codescout's create_file instead of native write." };
    }
    if (event.toolName === "read" && has(READ_TOOL)) {
      const path = (event.input as { path?: string }).path ?? "";
      if (!IMAGE_EXT.test(path)) {
        return { block: true, reason: "Use codescout's read_file or symbols instead of native read; native read is reserved for images." };
      }
    }
    if (event.toolName === "bash" && has(READ_TOOL)) {
      const command = (event.input as { command?: string }).command ?? "";
      if (isRedundantBashCommand(command)) {
        return {
          block: true,
          reason: "Use codescout's read_file, grep, symbols, or references for source inspection. Add '# codescout-override' only for deliberate raw shell access.",
        };
      }
    }
    return undefined;
  });
}
