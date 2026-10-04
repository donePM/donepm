import type { CheckLog, CiPr, Draft, DraftType, Event, FailedCheck, PermissionAsk, PermissionRule, PrDraft, PrDraftPayload, PushDraft, PrDraftResult, PrMerge, Repo, TranscriptMessage, WorkItem } from "@donepm/core";

// Mirrors of what the daemon's HTTP API returns (packages/daemon/src/http/server.ts).

export type ItemBadge = "no-local-clone" | "closed-upstream";

export interface CurrentTool {
  name: string;
  summary: string;
}

export interface AgentView {
  running: boolean;
  startedAt?: string;
  costUsd?: number;
  currentTool?: CurrentTool;
}

/** What a Needs You card shows. */
export type Attention =
  | { kind: "ask"; askId: string; toolName: string; input: unknown; rules: PermissionRule[]; reason?: string }
  | { kind: "draft"; draftId: string; draftType: DraftType; title: string; executing?: true; error?: string }
  | { kind: "ci_failed"; pr?: CiPr; failed: FailedCheck[]; logs: CheckLog[]; runs: string[] }
  | { kind: "pr_conflict"; pr: CiPr; base: string; files: string[] }
  | { kind: "failed"; reason: string; stderrTail?: string }
  | { kind: "resume"; reason: string };

/** `GET /api/worktrees/orphaned`: under donePM's root, used by no item. */
export interface OrphanWorktree {
  repoId: string;
  repoPath: string;
  path: string;
  branch?: string;
}

export interface ItemView extends WorkItem {
  repo: Pick<Repo, "id" | "path" | "originUrl" | "defaultBranch"> | null;
  badges: ItemBadge[];
  agent: AgentView;
  attention?: Attention;
  /** The pull request an approved draft opened, and whether it was merged since (D33). */
  pr?: PrView;
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

/** `scope: "run"` also grants the ask's suggested rules until the agent's session ends. */
export type AskAnswer =
  | { behavior: "allow"; scope?: "run"; /** AskUserQuestion only, by question text. */ answers?: Record<string, string> }
  | { behavior: "deny"; message?: string };

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
}

export interface Status {
  version: string;
  pid: number;
  gh?: GhStatus;
  claude?: ClaudeStatus;
  lastPoll?: PollStatus;
  lastScan?: string;
  runningAgents: number;
}

export interface Settings {
  port: number;
  repoRoot: string;
  worktreeRoot: string;
  branchPrefix: string;
  pollIntervalSeconds: number;
  maxConcurrentAgents: number;
  /** Remove a clean worktree once its PR is merged (D33). */
  removeWorktreeOnMerge: boolean;
  /** Per repository, keyed by normalised origin (`github.com/owner/repo`). */
  sources: Record<string, SourceSettings>;
  /** WebFetch to these hosts is allowed by the daemon without asking (D31). */
  allowedWebFetchDomains: string[];
}

export interface SourceSettings {
  /** GitHub issue search, as pasted. Absent: issues assigned to me. */
  query?: string;
  assignOnStart: boolean;
}

/** `POST /api/sources/test`. */
export interface SourceTest {
  count: number;
  issues: { number: number; title: string; url: string }[];
}

export type { Draft, Event, PermissionAsk, PermissionRule, PrDraft, PrDraftPayload, PushDraft, Repo, TranscriptMessage };
