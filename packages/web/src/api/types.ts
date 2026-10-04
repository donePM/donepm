import type {
  CheckLog, CiPr, CommentDraft, Draft, DraftReply, DraftType, Event, FailedCheck, FeedbackEntry, MergeMethod, PermissionAsk, PermissionRule, Playbook, PrDraft,
  PrDraftPayload, PushDraft, PrDraftResult, PrMerge, Repo, ReviewDraft, TranscriptMessage, WorkItem,
} from "@donepm/core";

// Mirrors of what the daemon's HTTP API returns (packages/daemon/src/http/server.ts).

export type ItemBadge = "no-local-clone" | "closed-upstream";

export interface CurrentTool {
  name: string;
  summary: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens?: number;
}

export interface AgentView {
  running: boolean;
  startedAt?: string;
  elapsedMs?: number;
  activeSince?: string;
  costUsd?: number;
  usage?: TokenUsage;
  currentTool?: CurrentTool;
}

/** What a Needs You card shows. */
export type Attention =
  | { kind: "ask"; askId: string; toolName: string; input: unknown; rules: PermissionRule[]; reason?: string }
  | { kind: "draft"; draftId: string; draftType: DraftType; title: string; executing?: true; error?: string }
  | { kind: "ci_failed"; pr?: CiPr; failed: FailedCheck[]; logs: CheckLog[]; runs: string[] }
  | { kind: "pr_conflict"; pr: CiPr; base: string; files: string[] }
  | { kind: "pr_feedback"; pr: CiPr; entries: FeedbackEntry[] }
  | { kind: "failed"; reason: string; stderrTail?: string }
  | { kind: "resume"; reason: string };

/** `GET /api/worktrees/orphaned`: under donePM's root, used by no item. */
export interface OrphanWorktree {
  repoId: string;
  repoPath: string;
  path: string;
  branch?: string;
  /** Disk use, when `du` could read it. */
  sizeBytes?: number;
  /** Date of its last commit, when git could read it. */
  lastCommitAt?: string;
}

/** `PUT /api/settings` 409: an item's worktree under the old root when the root changes (#93). */
export interface WorktreeAtOldRoot {
  itemId: string;
  title: string;
  path: string;
  /** Its agent is running; it would not be moved. */
  running: boolean;
}

/** `PUT /api/settings?worktrees=move`: what moved, and what stayed with the reason. */
export interface MoveOutcome {
  moved: Array<{ itemId: string; title: string; from: string; to: string }>;
  skipped: Array<{ itemId: string; title: string; path: string; reason: string }>;
}

export interface ItemView extends WorkItem {
  repo: Pick<Repo, "id" | "path" | "originUrl" | "defaultBranch"> | null;
  badges: ItemBadge[];
  agent: AgentView;
  attention?: Attention;
  /** The pull request an approved draft opened, and whether it was merged since (D33). */
  pr?: PrView;
  /** When the item finished: done, and its PR merged if a draft opened one (D37). Its card is muted. */
  finishedAt?: string;
  /** No local clone, and donePM can clone it (issue #37). */
  clone?: CloneState;
  /** Someone else's pull request: what still blocks the Merge button, and how it merges (D47). */
  merge?: MergeView;
  /** While it waits for CI: the checks of the last poll (spec 12.1). */
  ci?: { checks: CiCheckView[] };
}

/** `bucket` as gh reports it: pass, fail, pending, skipping, cancel. */
export interface CiCheckView {
  name: string;
  bucket: string;
  startedAt?: string;
}

export interface MergeView {
  /** Empty when the user approved, checks passed and GitHub says mergeable. */
  blockers: string[];
  /** The daemon merges it on its own once nothing blocks: the item's choice, else the repository's. */
  auto: boolean;
  /** The repository's merge method, the card's default. */
  method: MergeMethod;
}

/** Where a clone of the item's repository lands, whether `gh repo clone` runs, and why the last one failed. */
export interface CloneState {
  origin: string;
  target: string;
  cloning?: true;
  error?: string;
}

/** `POST /api/repos/clone`: 202 `started`, or 200 `cloned` when the clone was there already. */
export interface CloneResult {
  origin: string;
  path: string;
  result: "started" | "cloned";
}

/** `waiting`: the item sits in Needs You on the conflict; otherwise the user took it on (D36). */
export type PrView = PrDraftResult & PrMerge & { conflict?: { base: string; files: string[]; waiting: boolean } };

/** `GET /api/items/:id`. */
export interface ItemDetail extends ItemView {
  events: Event[];
  drafts: Draft[];
  asks: PermissionAsk[];
}

/** `GET /api/items/:id/diff`: merge base against the working tree, untracked files included. */
export interface ItemDiff {
  base: string;
  branch: string;
  commits: number;
  patch: string;
}

export type OpenTarget = "finder" | "terminal";

/**
 * `scope: "run"` also grants the ask's suggested rules until the agent's session ends; `"always"`
 * grants them in every run in the item's repository until the user removes them (D38).
 */
export type AskAnswer =
  | { behavior: "allow"; scope?: "run" | "always"; /** AskUserQuestion only, by question text. */ answers?: Record<string, string> }
  | { behavior: "deny"; message?: string; /** End the agent's turn with the deny. */ interrupt?: boolean };

export type CliState = "not_installed" | "not_logged_in" | "ready";

export interface GhStatus {
  state: CliState;
  path?: string;
  account?: string;
}

export interface ClaudeStatus {
  state: CliState;
  path?: string;
  version?: string;
}

export interface SourcePollStatus {
  ok: boolean;
  error?: string;
  issues?: number;
}

export interface PollStatus {
  at: string;
  ok: boolean;
  error?: string;
  issues?: number;
  /** Repositories with their own query, keyed by normalised origin. */
  sources?: Record<string, SourcePollStatus>;
  /** Unmanaged origins without a clone the searches found work in, with how much (D46). */
  discovered?: Record<string, number>;
}

/** A failed poll, newest first in `Status.pollErrors`. */
export interface PollError {
  at: string;
  error: string;
}

export interface Status {
  version: string;
  pid: number;
  /** When this daemon process started. */
  startedAt: string;
  gh?: GhStatus;
  claude?: ClaudeStatus;
  lastPoll?: PollStatus;
  lastScan?: string;
  runningAgents: number;
  /** The last five failed polls, newest first. */
  pollErrors: PollError[];
}

export interface Settings {
  port: number;
  repoRoot: string;
  worktreeRoot: string;
  /** Former worktree roots that still hold worktrees; kept by the daemon, read-only here (#93). */
  previousWorktreeRoots: string[];
  branchPrefix: string;
  pollIntervalSeconds: number;
  maxConcurrentAgents: number;
  /** Remove a clean worktree once its PR is merged (D33). */
  removeWorktreeOnMerge: boolean;
  /** Hours from finished to archived (D37). */
  archiveAfterHours: number;
  /** Days from archived to deleted; null: never (D37). */
  deleteAfterDays: number | null;
  /** Per repository, keyed by normalised origin (`github.com/owner/repo`). */
  sources: Record<string, SourceSettings>;
  /** WebFetch to these hosts is allowed by the daemon without asking (D31). */
  allowedWebFetchDomains: string[];
}

export interface SourceSettings {
  /** GitHub issue search, as pasted. Absent: issues assigned to me. */
  query?: string;
  assignOnStart: boolean;
  /** Polled and shown on the board (D46). Otherwise its items stay off the board unless they need attention. */
  managed?: boolean;
  /** Default of the card's "Merge automatically" for others' pull requests (D47). */
  autoMerge?: boolean;
  /** How others' pull requests are merged here; absent: squash (D47). */
  mergeMethod?: MergeMethod;
  /** The playbook its new issues start with; absent: chosen by labels. */
  playbook?: string;
}

/** `GET /api/repos`: a clone, and whether its origin is managed. */
export interface RepoView extends Repo {
  managed: boolean;
  /** Items of this repository with a worktree. */
  worktrees: number;
}

/** `GET /api/playbooks`: one global or repository playbook. */
export interface PlaybookEntry {
  name: string;
  model: string;
  effort?: string;
  permissionMode: Playbook["permissionMode"];
  drafts: Playbook["drafts"];
  readOnly?: boolean;
  file: string;
  scope: { kind: "global" } | { kind: "repo"; repoId: string; origin: string; path: string };
  /** A repository playbook that replaces the global one of the same name there. */
  overridesGlobal?: boolean;
}

export interface PlaybookList {
  globalDir: string;
  playbooks: PlaybookEntry[];
  problems: { file: string; error: string }[];
}

/** `GET /api/daemon`. */
export interface DaemonInfo {
  version: string;
  pid: number;
  port: number;
  startedAt: string;
  /** Started by launchd (`donepm install-service`), which can restart it, or by hand. */
  service: "launchd" | "manual";
  configFile: string;
  dbFile: string;
  dbBytes: number;
  logFile?: string;
  playbooksDir: string;
}

/** `POST /api/sources/test`. */
export interface SourceTest {
  count: number;
  issues: { number: number; title: string; url: string }[];
}

export type {
  CommentDraft, Draft, DraftReply, Event, FeedbackEntry, PermissionAsk, PermissionRule, PrDraft, PrDraftPayload, PushDraft, Repo, ReviewDraft,
  TranscriptMessage,
};
