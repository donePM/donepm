import stripAnsi from "strip-ansi";

const MAX = 120;

const FIELD: Record<string, string> = {
  Bash: "command",
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
  Glob: "pattern",
  Grep: "pattern",
  WebFetch: "url",
  WebSearch: "query",
  Task: "description",
  Agent: "description",
  // The Bash sandbox asking to connect (D27).
  SandboxNetworkAccess: "host",
};

function oneLine(s: string): string {
  const line = stripAnsi(s).trim().split("\n")[0] ?? "";
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line;
}

/**
 * The short form of a tool call's input shown next to its name: the command, the file, the pattern.
 * Falls back to the first string in the input for tools it does not know.
 */
export function toolSummary(name: string, input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const fields = input as Record<string, unknown>;
  const known = FIELD[name];
  if (known && typeof fields[known] === "string") return oneLine(fields[known]);
  if (name === "TodoWrite" && Array.isArray(fields.todos)) return `${fields.todos.length} todos`;
  if (name === "AskUserQuestion" && Array.isArray(fields.questions)) {
    const texts = fields.questions.map((q) => (q as { question?: unknown } | null)?.question).filter((q): q is string => typeof q === "string");
    if (texts.length === 0) return "";
    return texts.length > 1 ? `${oneLine(texts[0]!)} (+${texts.length - 1} more)` : oneLine(texts[0]!);
  }
  const first = Object.values(fields).find((v): v is string => typeof v === "string");
  return first ? oneLine(first) : "";
}
