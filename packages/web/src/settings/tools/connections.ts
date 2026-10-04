import type { ConnectionConfig, ConnectionState, Settings, Status } from "../../api/types";

/** What donePM has without a `connections` setting: github.com through gh (D50). */
export const DEFAULT_CONNECTIONS: ConnectionConfig[] = [{ id: "github", kind: "github", backend: "cli", host: "github.com" }];

export function configuredConnections(settings: Settings | undefined): ConnectionConfig[] {
  return settings?.connections ?? DEFAULT_CONNECTIONS;
}

export const STATE_LABEL: Record<ConnectionState, string> = {
  ready: "ready",
  not_installed: "not installed",
  not_logged_in: "not logged in",
  unreachable: "unreachable",
  unauthorized: "no access",
};

/** A connection id from a host: `github.acme.com` → `github-acme-com`. */
export function connectionId(host: string, taken: readonly string[]): string {
  const base = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "github";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** GitHub hosts gh is logged in to that no connection serves yet. */
export function offeredHosts(status: Status | undefined, settings: Settings | undefined): string[] {
  const served = new Set(configuredConnections(settings).map((c) => c.host));
  return (status?.ghKnownHosts ?? []).filter((h) => !served.has(h));
}

/** The connections with one more GitHub host through gh. */
export function withGitHubHost(connections: readonly ConnectionConfig[], host: string): ConnectionConfig[] {
  const id = connectionId(host, connections.map((c) => c.id));
  return [...connections, { id, kind: "github", backend: "cli", host }];
}

/** The settings name connections the running daemon does not have yet: a restart applies them. */
export function restartPending(status: Status | undefined, settings: Settings | undefined): boolean {
  if (!status?.connections || !settings) return false;
  const running = status.connections.map((c) => `${c.id}@${c.host ?? ""}`).sort().join(",");
  const configured = configuredConnections(settings).map((c) => `${c.id}@${c.host}`).sort().join(",");
  return running !== configured;
}
