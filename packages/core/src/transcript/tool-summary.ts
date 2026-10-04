import stripAnsi from "strip-ansi";

const MAX = 120;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function cut(s: string): string {
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s;
}

function oneLine(s: string): string {
  return cut(stripAnsi(s).trim().split("\n")[0] ?? "");
}

/** A path inside `cwd` (the worktree) without it; others as they are. */
export function relativePath(path: string, cwd?: string): string {
  if (!cwd) return path;
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  if (path === base) return ".";
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

/** `cd dir &&` / `cd dir;` at the start of a command: where it runs, not what it does. */
const CD_PREFIX = /^cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)(\s+2>\s*\/dev\/null)?\s*(&&|;)\s*/;
const SET_PREFIX = /^set\s+[-+][a-zA-Z]+(\s+[a-z]+)?\s*(&&|;)\s*/;
/** Lines that only set up the shell: `cd x`, `set -euo pipefail`, `X=1`, `export X=$(…)`, a bare `echo`. */
const NOISE = [
  /^cd(\s+("[^"]*"|'[^']*'|\S+))?(\s+2>\s*\/dev\/null)?\s*;?$/,
  /^set\s+[-+][a-zA-Z]+(\s+[a-z]+)?\s*;?$/,
  /^(export\s+|local\s+|readonly\s+)?[A-Za-z_]\w*=("[^"]*"|'[^']*'|\$\([^)]*\)|[^\s;]*)\s*;?$/,
  /^export\s+[A-Za-z_]\w*\s*;?$/,
  /^echo\s*;?$/,
];

/** Lines of a script, with `\` continuations joined, heredoc bodies and comments left out. */
function scriptLines(command: string): string[] {
  const out: string[] = [];
  let heredoc: string | undefined;
  let carry = "";
  for (const raw of command.split("\n")) {
    if (heredoc !== undefined) {
      if (raw.trim() === heredoc) heredoc = undefined;
      continue;
    }
    const line = carry + raw.trim();
    if (line.endsWith("\\")) {
      carry = `${line.slice(0, -1).trimEnd()} `;
      continue;
    }
    carry = "";
    if (line === "" || line.startsWith("#")) continue;
    const doc = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line);
    if (doc) heredoc = doc[2];
    out.push(line);
  }
  if (carry.trim()) out.push(carry.trim());
  return out;
}

function withoutPrefixes(line: string): string {
  let s = line;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(CD_PREFIX, "").replace(SET_PREFIX, "");
  }
  return s.replace(/;\s*$/, "");
}

/**
 * The part of a shell command that says what it does: leading `cd …&&`, `set -e` and variable
 * assignments are left out, heredoc bodies too, and the remaining lines are joined as `a; b`.
 */
export function bashSummary(command: string): string {
  const lines = scriptLines(stripAnsi(command));
  const kept = lines.map(withoutPrefixes).filter((l) => l !== "" && !NOISE.some((re) => re.test(l)));
  return cut((kept.length > 0 ? kept : lines).join("; "));
}

/** `host/path` of a URL, without scheme, query and fragment. */
function urlSummary(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i.exec(url.trim());
  if (!m) return oneLine(url);
  const path = m[2] === "/" ? "" : (m[2] ?? "");
  return cut(`${m[1]}${path}`);
}

function readSummary(path: string, input: Json): string {
  const offset = num(input.offset);
  const limit = num(input.limit);
  if (offset === undefined && limit === undefined) return path;
  const from = offset ?? 1;
  return limit === undefined ? `${path}:${from}-` : `${path}:${from}-${from + limit - 1}`;
}

function searchSummary(pattern: string, input: Json, cwd?: string): string {
  const path = str(input.path) && relativePath(str(input.path), cwd);
  const filter = str(input.glob) || str(input.type);
  return cut(`${pattern}${path && path !== "." ? ` in ${path}` : ""}${filter ? ` (${filter})` : ""}`);
}

interface Todo {
  content: string;
  activeForm: string;
  status: string;
}

/** The todos of a `TodoWrite` call. Entries without text are left out. */
export function todosOf(input: unknown): Todo[] {
  if (!isObject(input) || !Array.isArray(input.todos)) return [];
  return input.todos
    .filter(isObject)
    .map((t) => ({ content: str(t.content), activeForm: str(t.activeForm), status: str(t.status) }))
    .filter((t) => t.content !== "");
}

function todoSummary(input: Json): string {
  const todos = todosOf(input);
  const current = todos.find((t) => t.status === "in_progress");
  if (current) return oneLine(current.activeForm || current.content);
  const done = todos.filter((t) => t.status === "completed").length;
  if (todos.length === 0) return Array.isArray(input.todos) ? `${input.todos.length} todos` : "";
  return done === todos.length ? `all ${done} done` : `${done}/${todos.length} done`;
}

const FALLBACK_FIELD: Record<string, string> = {
  WebSearch: "query",
  WebFetch: "url",
  // The Bash sandbox asking to connect (D27).
  SandboxNetworkAccess: "host",
};

/**
 * The short form of a tool call's input shown next to its name: the command, the file, the
 * pattern. Paths inside `cwd` (the worktree) are shown relative to it. Falls back to the first
 * string in the input for tools it does not know.
 */
export function toolSummary(name: string, input: unknown, cwd?: string): string {
  if (!isObject(input)) return "";
  const path = (field: string) => (typeof input[field] === "string" ? cut(relativePath(input[field], cwd)) : undefined);
  switch (name) {
    case "Bash":
      if (typeof input.command === "string") return bashSummary(input.command);
      break;
    case "Read": {
      const p = path("file_path");
      if (p !== undefined) return cut(readSummary(p, input));
      break;
    }
    case "Write":
    case "Edit":
    case "MultiEdit": {
      const p = path("file_path");
      if (p !== undefined) return p;
      break;
    }
    case "NotebookEdit": {
      const p = path("notebook_path");
      if (p !== undefined) return p;
      break;
    }
    case "Grep":
    case "Glob":
      if (typeof input.pattern === "string") return searchSummary(input.pattern, input, cwd);
      break;
    case "Agent":
    case "Task":
      if (typeof input.description === "string") {
        const type = str(input.subagent_type);
        return oneLine(type ? `${type}: ${input.description}` : input.description);
      }
      break;
    case "TodoWrite":
      return todoSummary(input);
    case "AskUserQuestion":
      if (Array.isArray(input.questions)) {
        const texts = input.questions.map((q) => (isObject(q) ? q.question : undefined)).filter((q): q is string => typeof q === "string");
        if (texts.length === 0) return "";
        return texts.length > 1 ? `${oneLine(texts[0]!)} (+${texts.length - 1} more)` : oneLine(texts[0]!);
      }
      break;
  }
  const known = FALLBACK_FIELD[name];
  if (known && typeof input[known] === "string") return oneLine(input[known]);
  const first = Object.values(input).find((v): v is string => typeof v === "string");
  return first ? oneLine(first) : "";
}

/**
 * The headline of a step in the Agents view. Like `toolSummary`, but a Bash call reads as the
 * `description` Claude Code sends with it, when there is one, and a WebFetch as host and path.
 * Asks and grants keep the command and the full URL: that is what the user decides on.
 */
export function stepSummary(name: string, input: unknown, cwd?: string): string {
  if (name === "Bash" && isObject(input) && typeof input.description === "string" && input.description.trim() !== "") {
    return oneLine(input.description);
  }
  if (name === "WebFetch" && isObject(input) && typeof input.url === "string") return urlSummary(input.url);
  return toolSummary(name, input, cwd);
}

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  return lines;
}

/**
 * Pass and fail counts of a test run, from the last summary line in its output (vitest, jest,
 * pytest, cargo, PHPUnit). Undefined when there is none.
 */
export function testCounts(output: string): { passed: number; failed: number } | undefined {
  const lines = linesOf(stripAnsi(output));
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const passed = /\b(\d+) passed\b/.exec(line);
    const failed = /\b(\d+) failed\b/.exec(line);
    if (passed || failed) return { passed: Number(passed?.[1] ?? 0), failed: Number(failed?.[1] ?? 0) };
    const ok = /^OK \((\d+) tests?\b/.exec(line.trim());
    if (ok) return { passed: Number(ok[1]), failed: 0 };
    const php = /^Tests: (\d+), Assertions: \d+/.exec(line.trim());
    if (php) {
      const bad = Number(/Failures: (\d+)/.exec(line)?.[1] ?? 0) + Number(/Errors: (\d+)/.exec(line)?.[1] ?? 0);
      return { passed: Number(php[1]) - bad, failed: bad };
    }
  }
  return undefined;
}

const countsText = (c: { passed: number; failed: number }) =>
  c.failed > 0 ? `${c.failed} failed · ${c.passed} passed` : `${c.passed} passed`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : word.endsWith("ch") ? "es" : "s"}`;

/**
 * The note on the right of a finished step: exit status or error, test counts, files found, or how
 * many lines came back.
 */
export function resultNote(name: string, text: string, isError: boolean): string {
  const clean = stripAnsi(text);
  const lines = linesOf(clean);
  const first = lines[0]?.trim() ?? "";
  const tests = name === "Bash" ? testCounts(clean) : undefined;
  if (isError) {
    const exit = /^Exit code (\d+)/.exec(first);
    if (exit) return tests ? `exit ${exit[1]} · ${countsText(tests)}` : `exit ${exit[1]}`;
    if (/has been denied|^Permission to use/i.test(first)) return "denied";
    return "error";
  }
  if (tests) return countsText(tests);
  if (name === "Grep" || name === "Glob") {
    if (/^No (files|matches) found/.test(first)) return "no matches";
    const found = /^Found (\d+) (files?|lines?|matches)/.exec(first);
    if (found) return plural(Number(found[1]), found[2]!.startsWith("file") ? "file" : found[2]!.startsWith("line") ? "line" : "match");
    if (name === "Glob") return plural(lines.length, "file");
  }
  if (lines.length === 0) return "done";
  if (lines.length === 1) return first.length > 40 ? `${first.slice(0, 39)}…` : first;
  return `${lines.length} lines`;
}
