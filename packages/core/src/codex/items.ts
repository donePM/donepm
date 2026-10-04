import type { TranscriptKind } from "../transcript/types.js";
import { relativePath, toolSummary } from "../transcript/tool-summary.js";

// Codex's thread items (app-server protocol v2, `ThreadItem`): which transcript row each becomes and
// how the board names a tool call (issue #137). Kept apart from Claude Code's presenter.

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Items that are a tool call: the board shows them as the current tool while they run. */
const TOOL_ITEMS = new Set([
  "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "collabAgentToolCall", "imageView", "imageGeneration",
]);

export function isCodexToolItem(item: unknown): boolean {
  return isObject(item) && TOOL_ITEMS.has(str(item.type));
}

/**
 * The transcript kind of an item, or `raw` for one donePM does not draw. The user's own message is
 * `raw`: donePM records it when it sends it.
 */
export function codexItemKind(item: unknown): TranscriptKind {
  if (!isObject(item)) return "raw";
  if (item.type === "agentMessage") return "assistant_text";
  if (item.type === "reasoning") return "assistant_thinking";
  return isCodexToolItem(item) ? "tool_use" : "raw";
}

/**
 * Codex runs every command through the user's shell (`/bin/zsh -lc '…'`); the command is what is
 * inside. Anything else is returned as it is.
 */
export function unwrapShell(command: string): string {
  const m = /^(?:\S*\/)?(?:ba|z|da|k)?sh\s+-l?c\s+([\s\S]+)$/.exec(command.trim());
  if (!m) return command;
  const arg = m[1]!.trim();
  if (arg.length >= 2 && arg.startsWith("'") && arg.endsWith("'")) return arg.slice(1, -1).replace(/'\\''/g, "'");
  if (arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) return arg.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  return arg;
}

/** The name the board shows for a tool item, in Claude Code's words where there is one. */
export function codexToolName(item: unknown): string {
  if (!isObject(item)) return "tool";
  switch (item.type) {
    case "commandExecution":
      return "Bash";
    case "fileChange":
      return "Edit";
    case "webSearch":
      return "WebSearch";
    case "mcpToolCall":
      return `mcp__${str(item.server)}__${str(item.tool)}`;
    case "dynamicToolCall":
      return str(item.tool) || "tool";
    default:
      return str(item.type) || "tool";
  }
}

/** A one-line summary of a tool item, for the board and the transcript. */
export function codexToolSummary(item: unknown, cwd?: string): string {
  if (!isObject(item)) return "";
  switch (item.type) {
    case "commandExecution":
      return toolSummary("Bash", { command: unwrapShell(str(item.command)) }, cwd);
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes.filter(isObject) : [];
      const first = changes[0] ? relativePath(str(changes[0].path), cwd) : "";
      return changes.length > 1 ? `${first} (+${changes.length - 1} more)` : first;
    }
    case "webSearch":
      return str(item.query);
    case "imageView":
      return relativePath(str(item.path), cwd);
    default:
      return "";
  }
}

/**
 * A `fileChange` item's changes as one unified diff. Codex sends a bare hunk for an update and the
 * whole content for a new or deleted file; the headers are added here.
 */
export function codexDiff(item: unknown, cwd?: string): string {
  const changes = isObject(item) && Array.isArray(item.changes) ? item.changes.filter(isObject) : [];
  return changes
    .map((c) => {
      const path = relativePath(str(c.path), cwd);
      const kind = isObject(c.kind) ? str(c.kind.type) : "";
      const diff = str(c.diff);
      if (kind === "add" || kind === "delete") {
        const lines = diff.endsWith("\n") ? diff.slice(0, -1).split("\n") : diff.split("\n");
        const sign = kind === "add" ? "+" : "-";
        const head = kind === "add" ? `--- /dev/null\n+++ b/${path}` : `--- a/${path}\n+++ /dev/null`;
        const range = kind === "add" ? `@@ -0,0 +1,${lines.length} @@` : `@@ -1,${lines.length} +0,0 @@`;
        return `${head}\n${range}\n${lines.map((l) => sign + l).join("\n")}`;
      }
      const moved = isObject(c.kind) && typeof c.kind.move_path === "string" ? relativePath(c.kind.move_path, cwd) : path;
      return `--- a/${path}\n+++ b/${moved}\n${diff.replace(/\n$/, "")}`;
    })
    .join("\n");
}
