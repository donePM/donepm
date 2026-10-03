import type { Draft, Event, PermissionAsk, PrDraftPayload, Repo, TranscriptMessage, WorkItem } from "@donepm/core";

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
  | { kind: "ask"; askId: string; toolName: string; input: unknown }
  | { kind: "draft"; draftId: string; title: string }
  | { kind: "failed"; reason: string; stderrTail?: string };

export interface ItemView extends WorkItem {
  repo: Pick<Repo, "id" | "path" | "originUrl" | "defaultBranch"> | null;
  badges: ItemBadge[];
  agent: AgentView;
  attention?: Attention;
}

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

export type AskAnswer = { behavior: "allow" } | { behavior: "deny"; message?: string };

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

export interface PollStatus {
  at: string;
  ok: boolean;
  error?: string;
  issues?: number;
}

export interface Status {
  version: string;
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
}

export type { Draft, Event, PermissionAsk, PrDraftPayload, Repo, TranscriptMessage };
