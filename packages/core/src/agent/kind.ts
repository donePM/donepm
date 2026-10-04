/**
 * The coding agents donePM can run (issue #136). Claude Code is the only one; the union grows when a
 * second agent's adapter lands (#137). Stored on the item and on each transcript row.
 */
export const AGENT_KINDS = ["claude-code"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

/** The agent of items, playbooks and rows that do not name one: everything before #136. */
export const DEFAULT_AGENT: AgentKind = "claude-code";

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

/** The agent that runs an item: absent means Claude Code, the only agent before #136. */
export function agentOf(item: { agentKind?: AgentKind }): AgentKind {
  return item.agentKind ?? DEFAULT_AGENT;
}

/**
 * Which agent an item starts with. An agent fixed on the item (chosen on its card, or set by its
 * first start) wins, then the playbook's `agent`, then the repository's default, then Claude Code.
 * An item with a session but no agent predates #136, so its session is Claude Code's.
 */
export function chooseAgent(input: {
  item: { agentKind?: AgentKind; agentSessionId?: string };
  playbook?: { agent?: AgentKind };
  repo?: { agent?: AgentKind };
}): AgentKind {
  const { item } = input;
  if (item.agentKind) return item.agentKind;
  if (item.agentSessionId) return DEFAULT_AGENT;
  return input.playbook?.agent ?? input.repo?.agent ?? DEFAULT_AGENT;
}
