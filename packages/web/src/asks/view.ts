import stripAnsi from "strip-ansi";
import { toolDiff, type DiffLine } from "../transcript/rows";

/** What an ask shows of its tool's input: always all of it, never cut (issue #67). */
export type AskView =
  /** Bash: the whole command; its description and cwd when the input has them. */
  | { kind: "command"; command: string; description?: string; cwd?: string }
  /** Write, Edit, MultiEdit: the file and the change. */
  | { kind: "edit"; path: string; diff: DiffLine[] }
  /** WebFetch, the sandbox's network question: the URL or host on its own. */
  | { kind: "target"; target: string }
  /** MCP and unknown tools: the input as JSON. */
  | { kind: "json"; text: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

const TARGET: Record<string, string> = { WebFetch: "url", SandboxNetworkAccess: "host" };

/** Home directories as `~`; the user knows where their home is. */
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** `worktree`: the item's worktree; a cwd there is the default and not worth a line. */
export function askView(toolName: string, input: unknown, worktree?: string): AskView {
  const fields = isObject(input) ? input : {};
  if (toolName === "Bash" && str(fields.command)) {
    const description = str(fields.description);
    const cwd = str(fields.cwd);
    return {
      kind: "command",
      command: fields.command as string,
      ...(description ? { description } : {}),
      ...(cwd && cwd !== worktree ? { cwd: tildePath(cwd) } : {}),
    };
  }
  const diff = toolDiff(toolName, input);
  const path = str(fields.file_path);
  if (diff && path) return { kind: "edit", path: tildePath(path), diff };
  const target = TARGET[toolName] && str(fields[TARGET[toolName]]);
  if (target) return { kind: "target", target };
  return { kind: "json", text: JSON.stringify(input, null, 2) };
}

/** What "Copy" puts on the clipboard: the command, the target, or the input as JSON. */
export function askCopyText(view: AskView): string | undefined {
  if (view.kind === "command") return view.command;
  if (view.kind === "target") return view.target;
  if (view.kind === "json") return view.text;
  return view.path;
}

/** The CLI's `decision_reason` as plain text; undefined when it says nothing. */
export function askReason(reason: string | undefined): string | undefined {
  const text = reason && stripAnsi(reason).trim();
  return text || undefined;
}
