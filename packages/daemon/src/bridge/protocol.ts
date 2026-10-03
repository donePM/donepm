/**
 * The line the shim sends before any MCP byte crosses, and the daemon's one-line answer
 * (Bloom BRIDGE.md §1). The version is compared for equality, never as a range: the skew to
 * design for is a shim from one build meeting a daemon from another.
 */
export const BRIDGE_PROTOCOL = 1;

export interface Hello {
  bridge: number;
  token: string;
}

export type Welcome = { ok: true } | { ok: false; reason: string };

/** Shim exit statuses. The CLI prints them, so each says something different. */
export const EXIT = {
  /** `DONEPM_SOCKET` or `DONEPM_TOKEN` missing: nothing to connect to. */
  unconfigured: 64,
  /** The socket could not be reached, or the daemon went away mid-session. */
  unreachable: 69,
  /** The daemon refused the handshake. */
  refused: 70,
} as const;
