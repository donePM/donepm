import type { GhStatus } from "../gh/detect.js";

export interface PollStatus {
  at: string;
  ok: boolean;
  /** Command or schema error, shown as a badge in Settings. */
  error?: string;
  issues?: number;
}

export interface Status {
  version: string;
  gh: GhStatus | undefined;
  lastPoll: PollStatus | undefined;
  runningAgents: number;
}

type Listener = (status: Status) => void;

/** In-memory daemon status. Every change notifies listeners (pushed as `status.changed`). */
export class StatusStore {
  private status: Status;
  private readonly listeners = new Set<Listener>();

  constructor(version: string) {
    this.status = { version, gh: undefined, lastPoll: undefined, runningAgents: 0 };
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
