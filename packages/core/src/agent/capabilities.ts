import type { AgentKind } from "./kind.js";

/** Playbook `permission_mode` values (spec 8.2), named as Claude Code names them. */
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Codex's `ReasoningEffort` values (app-server protocol v2). */
export const CODEX_EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

/** What an agent can do, so playbooks, the runner and the UI ask the agent instead of assuming Claude Code. */
export interface AgentCapabilities {
  /** Playbook `permission_mode` values the agent takes. */
  permissionModes: readonly PermissionMode[];
  /** Playbook `effort` values the agent takes; absent: any value is passed on as written. */
  effortLevels?: readonly string[];
  /** "Allow for this run" can grant rules the agent suggested (D30). */
  sessionRules: boolean;
  /** "Always allow" grants per repository can answer its asks (D38). */
  alwaysAllow: boolean;
  /** The agent reports a price per turn; without one the UI shows tokens only, never "$0.00". */
  reportsCost: boolean;
  /** A new turn after a closed one goes to the same process; otherwise each resume starts one. */
  resumeInSameProcess: boolean;
}

export const AGENT_CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
  "claude-code": {
    permissionModes: PERMISSION_MODES,
    // No `effortLevels`: the CLI checks `--effort` itself, and donePM passes it through as before.
    sessionRules: true,
    alwaysAllow: true,
    reportsCost: true,
    resumeInSameProcess: true,
  },
  codex: {
    // No `plan` (Codex has no such mode) and no `bypassPermissions` (it would mean `never` with
    // `danger-full-access`, which opens the network): refused, never silently widened (#137).
    permissionModes: ["default", "acceptEdits"],
    effortLevels: CODEX_EFFORT_LEVELS,
    // Codex suggests no rules. "For this run" is its own `acceptForSession`, kept by the process.
    sessionRules: false,
    alwaysAllow: false,
    // Tokens only: Codex reports no price anywhere.
    reportsCost: false,
    resumeInSameProcess: true,
  },
};

/**
 * Why a playbook cannot run with an agent, one line per problem; empty when it can. Checked when a
 * playbook names its agent, and again when an item starts with an agent the playbook did not name.
 */
export function playbookProblems(playbook: { permissionMode: string; effort?: string }, agent: AgentKind): string[] {
  const caps = AGENT_CAPABILITIES[agent];
  const problems: string[] = [];
  if (!(caps.permissionModes as readonly string[]).includes(playbook.permissionMode)) {
    problems.push(`permission_mode ${playbook.permissionMode} is not available with ${agent}`);
  }
  if (playbook.effort !== undefined && caps.effortLevels && !caps.effortLevels.includes(playbook.effort)) {
    problems.push(`effort ${playbook.effort} is not available with ${agent}`);
  }
  return problems;
}
