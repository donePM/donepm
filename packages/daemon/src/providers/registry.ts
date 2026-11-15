import { AZURE_DEVOPS_HOST, azureOrganizationOf, isAzureDevOpsHost, parseTicketId } from "@donepm/core";
import type { ConnectionState } from "../status/status.js";
import type { CiSource } from "./ci-source.js";
import type { CodeHost } from "./code-host.js";
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
  /** The one organization it serves on dev.azure.com, where many share the host (issue #141). */
  organization?: string;
  ticketSource?: TicketSource;
  codeHost?: CodeHost;
  ciSource?: CiSource;
  /**
   * Where the connection stands, asked of the provider (`/myself` for Jira, `az account show` or
   * `connectionData` for Azure DevOps) where `gh` detection does not cover it. Never reads out the token.
   */
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

/**
 * The connection serves the origin or URL: same host, and on Azure DevOps the same organization,
 * whichever of its host names (`dev.azure.com`, `<org>.visualstudio.com`) the URL uses.
 */
export function serves(c: Connection, where: string): boolean {
  const host = hostOf(where);
  if (c.organization !== undefined) return isAzureDevOpsHost(host) && c.host === AZURE_DEVOPS_HOST && azureOrganizationOf(where) === c.organization;
  return c.host === host;
}

export function providerRegistry(connections: readonly Connection[]): Providers {
  const byHost = <R>(role: (c: Connection) => R | undefined) => (where: string): R | undefined => {
    for (const c of connections) {
      const adapter = role(c);
      if (adapter && serves(c, where)) return adapter;
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

/**
 * The connection an item's ticket comes from: the one a ticket id names (`jira:APP-1`, issue #139),
 * else the one serving its origin's host, as for a GitHub issue.
 */
export function ticketConnectionOf(providers: Providers, ticket: { externalId: string; origin: string }): Connection | undefined {
  const named = parseTicketId(ticket.externalId);
  if (named) {
    const c = providers.connections.find((x) => x.id === named.connection && x.ticketSource);
    if (c) return c;
  }
  if (!ticket.origin) return undefined;
  return providers.connections.find((c) => c.ticketSource && serves(c, ticket.origin));
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
  const host = hostOf(where);
  const organization = isAzureDevOpsHost(host) ? azureOrganizationOf(where) : undefined;
  return organization ? `no connection for the Azure DevOps organization ${organization}` : `no connection for ${host || where}`;
}
