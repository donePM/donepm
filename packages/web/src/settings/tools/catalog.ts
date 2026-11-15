import type { Status } from "../../api/types";
import { claudeHint, codexHint, ghHint, helperHint, type CliHint } from "./hints";

/**
 * What a tool is for (issue #152). Coding agents live in Agents & access; source clients (how work
 * is collected and drafts go out) and helpers (optional CLIs an agent may use) live in Tools.
 */
export type ToolCategory = "agent" | "source" | "helper";

export const CATEGORY_LABEL: Record<ToolCategory, string> = {
  agent: "Coding agents",
  source: "Source clients",
  helper: "Helpers",
};

export interface ToolRow {
  id: string;
  category: ToolCategory;
  name: string;
  /** "gh", "claude 2.1.270". */
  tag: string;
  /** Absent while the daemon has not checked yet. */
  hint?: CliHint;
  /** Shown in a green badge when ready. */
  ready: string;
  detail: string;
}

/** A tool that is not supported yet, shown as a muted row. */
export interface PlannedTool {
  id: string;
  category: ToolCategory;
  name: string;
  note: string;
  /** The issue that adds it. */
  issue: number;
}

/** Optional helpers the daemon detects, by the id it reports them under. */
const HELPERS: { id: string; name: string; purpose: string; install: string }[] = [
  { id: "playwright-cli", name: "Playwright CLI", purpose: "drives a browser, for agents that check a UI", install: "npm install -g @playwright/cli@latest" },
];

export const PLANNED: PlannedTool[] = [
  { id: "jira", category: "source", name: "Jira CLI", note: "Will use acli or jira-cli, or a token in the keychain.", issue: 139 },
  { id: "az", category: "source", name: "Azure DevOps CLI", note: "Will use az for Azure Boards, Repos and Pipelines.", issue: 141 },
];

/** Every detected tool as a row, each in exactly one category. */
export function toolRows(status: Status | undefined): ToolRow[] {
  const gh = status?.gh;
  const claude = status?.claude;
  const codex = status?.codex;
  const rows: ToolRow[] = [
    {
      id: "claude",
      category: "agent",
      name: "Claude Code",
      tag: claude?.version ? `claude ${claude.version}` : "claude",
      hint: claude && claudeHint(claude.state),
      ready: "ready",
      detail: [claude?.path, "runs the agents"].filter(Boolean).join(" · "),
    },
    {
      id: "codex",
      category: "agent",
      name: "Codex",
      tag: codex?.version ? `codex ${codex.version}` : "codex",
      hint: status && codexHint(codex?.state),
      ready: "ready",
      detail: [codex?.path, "runs items whose card or playbook picks it"].filter(Boolean).join(" · "),
    },
    {
      id: "gh",
      category: "source",
      name: "GitHub CLI",
      tag: "gh",
      hint: gh && ghHint(gh.state),
      ready: gh?.account ? `logged in as ${gh.account}` : "ready",
      detail: [gh?.path, "used for polling, PR creation, merges and comments"].filter(Boolean).join(" · "),
    },
  ];
  // The same gh, logged in to each further GitHub host on its own (issue #140).
  for (const [host, found] of Object.entries(status?.ghHosts ?? {})) {
    rows.push({
      id: `gh:${host}`,
      category: "source",
      name: `GitHub CLI on ${host}`,
      tag: "gh",
      hint: ghHint(found.state, host),
      ready: found.account ? `logged in as ${found.account}` : "ready",
      detail: [found.path, `used for ${host}`].filter(Boolean).join(" · "),
    });
  }
  for (const h of HELPERS) {
    const found = status?.helpers?.[h.id];
    rows.push({
      id: h.id,
      category: "helper",
      name: h.name,
      tag: found?.version ? `${h.id} ${found.version}` : h.id,
      hint: status?.helpers && helperHint(found, h.install),
      ready: "installed",
      detail: [found?.path, h.purpose].filter(Boolean).join(" · "),
    });
  }
  return rows;
}

/** The rows and planned tools of the given categories, grouped in that order; empty groups are left out. */
export function toolGroups(
  status: Status | undefined,
  categories: readonly ToolCategory[],
): { category: ToolCategory; label: string; rows: ToolRow[]; planned: PlannedTool[] }[] {
  const rows = toolRows(status);
  return categories
    .map((category) => ({
      category,
      label: CATEGORY_LABEL[category],
      rows: rows.filter((r) => r.category === category),
      planned: PLANNED.filter((p) => p.category === category),
    }))
    .filter((g) => g.rows.length || g.planned.length);
}
