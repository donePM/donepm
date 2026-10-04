import { claudeAskSubject, type AskSubject } from "@donepm/core";
import { parsePatch } from "diff";
import stripAnsi from "strip-ansi";
import { toolDiff, type DiffLine } from "../transcript/rows";

/** What an ask shows of what the agent wants: always all of it, never cut (issue #67). */
export type AskView =
  /** A shell command, whole; its description and cwd when the agent gave them. */
  | { kind: "command"; command: string; description?: string; cwd?: string }
  /** A file write or edit: the file and the change. */
  | { kind: "edit"; path: string; diff: DiffLine[] }
  /** A fetch or a connection: the URL or host on its own. */
  | { kind: "target"; target: string }
  /** MCP and unknown tools: the input as JSON. */
  | { kind: "json"; text: string };

/** Home directories as `~`; the user knows where their home is. */
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/**
 * The view of an ask, drawn from its neutral subject (issue #136). Without one (a row from the
 * transcript alone) the subject comes from Claude Code's tool name and input. `worktree`: the
 * item's worktree; a cwd there is the default and not worth a line.
 */
export function askView(toolName: string, input: unknown, worktree?: string, subject?: AskSubject): AskView {
  const s = subject ?? claudeAskSubject(toolName, input);
  switch (s.kind) {
    case "command":
      return {
        kind: "command",
        command: s.command,
        ...(s.description ? { description: s.description } : {}),
        ...(s.cwd && s.cwd !== worktree ? { cwd: tildePath(s.cwd) } : {}),
      };
    case "file_change": {
      const diff = s.diff !== undefined ? patchLines(s.diff) : toolDiff(toolName, input);
      if (diff) return { kind: "edit", path: tildePath(s.path), diff };
      break;
    }
    case "network":
      return { kind: "target", target: s.url ?? s.host };
  }
  return { kind: "json", text: JSON.stringify(input, null, 2) };
}

/** A unified diff from the agent as diff lines, headers left out. */
function patchLines(patch: string): DiffLine[] {
  return parsePatch(patch).flatMap((file) =>
    file.hunks.flatMap((h, i) => [
      ...(i > 0 ? [{ op: " ", text: "…" } as DiffLine] : []),
      ...h.lines.filter((l) => /^[ +-]/.test(l)).map((l) => ({ op: l[0], text: l.slice(1) }) as DiffLine),
    ]),
  );
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
