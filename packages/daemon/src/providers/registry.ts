import type { CiSource } from "./ci-source.js";
import type { CodeHost } from "./code-host.js";
import type { ConnectionState } from "../status/status.js";
import type { TicketSource } from "./ticket-source.js";

export type Backend = "cli" | "api";

/**
 * One configured way to reach a provider (issue #138): GitHub on a host through `gh`, later Jira
 * over its API. It fills the roles its provider has; a code host connection is found by host.
 */
export interface Connection {
  id: string;
  kind: string;
  backend: Backend;
  /** The host its repositories and pull requests live on, for a code host. */
  host?: string;
  ticketSource?: TicketSource;
  codeHost?: CodeHost;
  ciSource?: CiSource;
  /** Where an `api` connection stands, asked of the provider (`/myself` for Jira). Never reads out the token. */
  health?: () => Promise<{ state: ConnectionState; detail?: string }>;
}

/** The adapters by role, looked up by the host of an origin or a URL. */
export interface Providers {
  connections: readonly Connection[];
  ticketSources(): Array<{ connection: Connection; source: TicketSource }>;
  /** The ticket source of a normalised origin (`host/owner/repo`) or a URL. */
  ticketSource(where: string): TicketSource | undefined;
  codeHost(where: string): CodeHost | undefined;
  ciSource(where: string): CiSource | undefined;
}

/** `github.com` from `github.com/owner/repo` or `https://github.com/owner/repo/pull/1`. */
export function hostOf(where: string): string {
  if (where.includes("://")) {
    try {
      return new URL(where).host.toLowerCase();
    } catch {
      return "";
    }
  }
  return (where.split("/")[0] ?? "").toLowerCase();
}

export function providerRegistry(connections: readonly Connection[]): Providers {
  const byHost = <R>(role: (c: Connection) => R | undefined) => (where: string): R | undefined => {
    const host = hostOf(where);
    for (const c of connections) {
      const adapter = role(c);
      if (adapter && c.host === host) return adapter;
    }
    return undefined;
  };
  return {
    connections,
    ticketSources: () => connections.flatMap((connection) => (connection.ticketSource ? [{ connection, source: connection.ticketSource }] : [])),
    ticketSource: byHost((c) => c.ticketSource),
    codeHost: byHost((c) => c.codeHost),
    ciSource: byHost((c) => c.ciSource),
  };
}

/** Thrown where an origin or URL names a host no connection serves. */
export class NoConnectionError extends Error {
  constructor(where: string) {
    super(noConnection(where));
    this.name = "NoConnectionError";
  }
}

/** The error of a call to a host no connection serves. */
export function noConnection(where: string): string {
  return `no connection for ${hostOf(where) || where}`;
}
