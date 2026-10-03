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
};

function oneLine(s: string): string {
  const line = s.trim().split("\n")[0] ?? "";
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
  const first = Object.values(fields).find((v): v is string => typeof v === "string");
  return first ? oneLine(first) : "";
}
