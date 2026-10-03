import type { Repo, TranscriptMessage, WorkItem } from "@donepm/core";

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

export interface ItemView extends WorkItem {
  repo: Pick<Repo, "id" | "path" | "originUrl" | "defaultBranch"> | null;
  badges: ItemBadge[];
  agent: AgentView;
}

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

export type { Repo, TranscriptMessage };
