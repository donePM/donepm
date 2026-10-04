import type { MergeMethod, PrDraftResult, PrMerge, Repo, WorkItem } from "@donepm/core";
import type { CloneState } from "../repos/clone.js";
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
  /** The pull request an executed draft opened (Done), and whether it was merged (D33). */
  pr?: PrView;
  /** When the item finished: done, and its PR merged if it has one (D37). Its card is muted. */
  finishedAt?: string;
  /** No local clone, and donePM can make one: where it lands, and how the last try went (issue #37). */
  clone?: CloneState;
  /** Someone else's pull request: what still blocks the Merge button, and how it merges (D47). */
  merge?: MergeView;
  /** While it waits for CI: the checks of the last poll, for the card's badges (spec 12.1). */
  ci?: CiView;
  /** The playbooks its repository offers the item's ingest, the card's choice (issue #153). */
  allowedPlaybooks: string[];
}

/** One check as the last `gh pr checks` reported it; `bucket` is gh's: pass, fail, pending, skipping, cancel. */
export interface CiCheckView {
  name: string;
  bucket: string;
  startedAt?: string;
}

export interface CiView {
  checks: CiCheckView[];
}

export interface MergeView {
  /** Empty when the user approved, checks passed and GitHub says mergeable. */
  blockers: string[];
  /** The daemon merges it on its own once nothing blocks: the item's choice, else the repository's. */
  auto: boolean;
  /** The repository's merge method, the card's default. */
  method: MergeMethod;
}

export type PrView = PrDraftResult &
  PrMerge & {
    /** The PR conflicts with its base (D36). `waiting`: the item sits in Needs You on it. */
    conflict?: { base: string; files: string[]; waiting: boolean };
  };

export function toItemView(
  item: WorkItem,
  repo: Repo | undefined,
  agent: AgentView = { running: false },
  attention?: Attention,
  pr?: PrView,
  allowedPlaybooks: string[] = [],
): ItemView {
  const badges: ItemBadge[] = [];
  if (!repo) badges.push("no-local-clone");
  if (item.closedUpstream) badges.push("closed-upstream");
  return {
    ...item,
    repo: repo ? { id: repo.id, path: repo.path, originUrl: repo.originUrl, defaultBranch: repo.defaultBranch } : null,
    badges,
    allowedPlaybooks,
    agent,
    ...(attention ? { attention } : {}),
    ...(pr ? { pr } : {}),
  };
}
