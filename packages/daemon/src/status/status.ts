import type { ClaudeStatus } from "../claude/detect.js";
import type { GhStatus } from "../gh/detect.js";

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
}

export interface Status {
  version: string;
  /** The daemon's process id; `donepm stop` signals it. */
  pid: number;
  gh: GhStatus | undefined;
  claude: ClaudeStatus | undefined;
  lastPoll: PollStatus | undefined;
  /** When the repo root was last scanned. */
  lastScan: string | undefined;
  runningAgents: number;
}

type Listener = (status: Status) => void;

/** In-memory daemon status. Every change notifies listeners (pushed as `status.changed`). */
export class StatusStore {
  private status: Status;
  private readonly listeners = new Set<Listener>();

  constructor(version: string, pid = process.pid) {
    this.status = { version, pid, gh: undefined, claude: undefined, lastPoll: undefined, lastScan: undefined, runningAgents: 0 };
  }

  get(): Status {
    return this.status;
  }

  update(patch: Partial<Status>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
