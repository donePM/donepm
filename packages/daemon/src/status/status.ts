import type { ClaudeStatus } from "../claude/detect.js";
import type { GhStatus } from "../gh/detect.js";
import type { HelperStatus } from "../helpers/detect.js";

/** How one repository's own query fared in the last poll. */
export interface SourcePollStatus {
  ok: boolean;
  error?: string;
  issues?: number;
}

export interface PollStatus {
  at: string;
  ok: boolean;
  /** Command or schema error, shown as a badge in Settings. */
  error?: string;
  /** Distinct issues across all sources. */
  issues?: number;
  /** Per repository with its own query, keyed by normalised origin. */
  sources?: Record<string, SourcePollStatus>;
  /**
   * Unmanaged origins without a local clone that the searches found work in, with the number of
   * issues and pull requests, keyed by normalised origin. Settings offers to clone and manage them (D46).
   */
  discovered?: Record<string, number>;
}

/** A failed poll, kept for Settings > Tools. */
export interface PollError {
  at: string;
  error: string;
}

/** How many failed polls the status keeps. */
export const POLL_ERRORS_KEPT = 5;

export interface Status {
  version: string;
  /** The daemon's process id; `donepm stop` signals it. */
  pid: number;
  /** When this daemon process started; Settings shows the uptime. */
  startedAt: string;
  gh: GhStatus | undefined;
  claude: ClaudeStatus | undefined;
  /** Optional helper CLIs by id (issue #152); undefined until first detected. */
  helpers: Record<string, HelperStatus> | undefined;
  lastPoll: PollStatus | undefined;
  /** When the repo root was last scanned. */
  lastScan: string | undefined;
  runningAgents: number;
  /** The last failed polls, newest first (at most POLL_ERRORS_KEPT). */
  pollErrors: PollError[];
}

type Listener = (status: Status) => void;

/** In-memory daemon status. Every change notifies listeners (pushed as `status.changed`). */
export class StatusStore {
  private status: Status;
  private readonly listeners = new Set<Listener>();

  constructor(version: string, startedAt: string, pid = process.pid) {
    this.status = {
      version, pid, startedAt, gh: undefined, claude: undefined, helpers: undefined, lastPoll: undefined, lastScan: undefined, runningAgents: 0, pollErrors: [],
    };
  }

  get(): Status {
    return this.status;
  }

  /** A `lastPoll` with an error is also added to `pollErrors`. */
  update(patch: Partial<Omit<Status, "pollErrors">>): void {
    const failed = patch.lastPoll?.error ? { at: patch.lastPoll.at, error: patch.lastPoll.error } : undefined;
    const pollErrors = failed ? [failed, ...this.status.pollErrors].slice(0, POLL_ERRORS_KEPT) : this.status.pollErrors;
    this.status = { ...this.status, ...patch, pollErrors };
    for (const l of this.listeners) l(this.status);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
