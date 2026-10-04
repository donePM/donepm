import type { CliState, Status } from "../api/types";

export type Health = "unknown" | "ok" | "problem";

interface Tool {
  name: string;
  /** An optional tool in a bad state is not a problem. */
  required: boolean;
  /** The settings section that shows the tool (issue #152). */
  section?: "agents" | "tools";
  state: (s: Status) => CliState | undefined;
}

export const tools: Tool[] = [
  { name: "gh", required: true, section: "tools", state: (s) => s.gh?.state },
  { name: "claude", required: true, section: "agents", state: (s) => s.claude?.state },
];

/**
 * What is wrong, as short sentences; empty when all is well. The one source for the top bar and
 * Settings. `poll: false` leaves a failed poll out, for a section that does not show polling.
 */
export function problems(status: Status | undefined, reachable: boolean, registry: Tool[] = tools, poll = true): string[] {
  if (!reachable) return ["daemon is not reachable"];
  if (!status) return [];
  const out: string[] = [];
  for (const tool of registry) {
    if (!tool.required) continue;
    const state = tool.state(status);
    if (state === "not_installed") out.push(`${tool.name} is not installed`);
    else if (state === "not_logged_in") out.push(`${tool.name} is not logged in`);
  }
  if (poll && status.lastPoll?.ok === false) out.push("last poll failed");
  return out;
}

export function health(status: Status | undefined, reachable: boolean, registry: Tool[] = tools, poll = true): Health {
  if (problems(status, reachable, registry, poll).length) return "problem";
  if (!status || registry.some((t) => t.required && t.state(status) === undefined)) return "unknown";
  return "ok";
}

export function summary(list: string[]): string {
  return list.length === 1 ? `Problem: ${list[0]}` : `${list.length} problems: ${list.join("; ")}`;
}
