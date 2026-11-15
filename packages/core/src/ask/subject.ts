import { isQuestionTool, questionsOf, type Question } from "./question.js";

/**
 * What a permission ask is about, in words no agent owns (issue #136). The ask panel draws from it;
 * the agent's own tool name and input stay on the ask for its adapter and for the record.
 */
export type AskSubject =
  /** A shell command. `description` is the agent's own note on it. */
  | { kind: "command"; command: string; description?: string; cwd?: string }
  /** A file write or edit. `diff` is a unified diff when the agent sends one; else the presenter makes one from the input. */
  | { kind: "file_change"; path: string; diff?: string }
  /** A connection to a host, or a fetch of `url`. */
  | { kind: "network"; host: string; url?: string }
  /** Questions for the user to answer, not a permission (spec 9.4). */
  | { kind: "question"; questions: Question[] }
  /** Anything else: an MCP tool, a tool donePM does not know. */
  | { kind: "tool"; name: string; input: unknown };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

/** Claude Code's `can_use_tool` request as a subject: its tool names and input fields (spec 9.4). */
export function claudeAskSubject(toolName: string, input: unknown): AskSubject {
  const fields = isObject(input) ? input : {};
  const command = str(fields.command);
  if (toolName === "Bash" && command) {
    const description = str(fields.description);
    const cwd = str(fields.cwd);
    return { kind: "command", command, ...(description ? { description } : {}), ...(cwd ? { cwd } : {}) };
  }
  const path = str(fields.file_path);
  if (FILE_TOOLS.has(toolName) && path) return { kind: "file_change", path };
  if (toolName === "WebFetch" && str(fields.url)) return { kind: "network", host: hostOf(fields.url as string), url: fields.url as string };
  // The Bash sandbox asks before any connection (D27).
  if (toolName === "SandboxNetworkAccess" && str(fields.host)) return { kind: "network", host: fields.host as string };
  if (isQuestionTool(toolName)) return { kind: "question", questions: questionsOf(input) };
  return { kind: "tool", name: toolName, input };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
