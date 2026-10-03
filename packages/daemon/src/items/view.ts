import type { Repo, WorkItem } from "@donepm/core";
import type { AgentHistory } from "./agent-info.js";
import type { Attention } from "./attention.js";

export type ItemBadge = "no-local-clone" | "closed-upstream";

/** The tool the agent is waiting on right now. */
export interface CurrentTool {
  name: string;
  /** Short form of the input, e.g. the command or the file path. */
  summary: string;
}

export interface AgentView extends AgentHistory {
  /** A `claude` process is alive for this item. */
  running: boolean;
  currentTool?: CurrentTool;
}

/** What the API returns for an item: the item, its clone (if any) and display badges. */
export interface ItemView extends WorkItem {
  repo: Pick<Repo, "id" | "path" | "originUrl" | "defaultBranch"> | null;
  badges: ItemBadge[];
  agent: AgentView;
  /** Set while the item waits on the user (Needs You). */
  attention?: Attention;
}

export function toItemView(
  item: WorkItem,
  repo: Repo | undefined,
  agent: AgentView = { running: false },
  attention?: Attention,
): ItemView {
  const badges: ItemBadge[] = [];
  if (!repo) badges.push("no-local-clone");
  if (item.closedUpstream) badges.push("closed-upstream");
  return {
    ...item,
    repo: repo ? { id: repo.id, path: repo.path, originUrl: repo.originUrl, defaultBranch: repo.defaultBranch } : null,
    badges,
    agent,
    ...(attention ? { attention } : {}),
  };
}
