import type { ConnectionConfig, ConnectionState, ConnectionStatus, JiraConnectionConfig, JiraDeployment, Settings, Status } from "../../api/types";

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

/** The host a connection talks to: its own for GitHub and Azure DevOps, its base URL's for Jira. */
export function hostOfConnection(c: ConnectionConfig): string {
  if (c.kind !== "jira") return c.host;
  try {
    return new URL(c.baseUrl).host.toLowerCase();
  } catch {
    return "";
  }
}

/** A connection id from a host: `github.acme.com` → `github-acme-com`. */
export function connectionId(host: string, taken: readonly string[]): string {
  const base = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "github";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** GitHub hosts gh is logged in to that no connection serves yet. */
export function offeredHosts(status: Status | undefined, settings: Settings | undefined): string[] {
  const served = new Set(configuredConnections(settings).map(hostOfConnection));
  return (status?.ghKnownHosts ?? []).filter((h) => !served.has(h));
}

/** The connections with one more GitHub host through gh. */
export function withGitHubHost(connections: readonly ConnectionConfig[], host: string): ConnectionConfig[] {
  const id = connectionId(host, connections.map((c) => c.id));
  return [...connections, { id, kind: "github", backend: "cli", host }];
}

export interface JiraForm {
  baseUrl: string;
  deployment: JiraDeployment;
  email: string;
}

/** The connections with one more Jira site; the first is `jira`, so its items are `jira:KEY`. */
export function withJira(connections: readonly ConnectionConfig[], form: JiraForm): ConnectionConfig[] {
  const id = connectionId("jira", connections.map((c) => c.id));
  const email = form.email.trim();
  const jira: JiraConnectionConfig = {
    id,
    kind: "jira",
    backend: "api",
    baseUrl: form.baseUrl.trim(),
    deployment: form.deployment,
    ...(form.deployment === "cloud" && email ? { email } : {}),
  };
  return [...connections, jira];
}

export interface AzureDevOpsForm {
  organization: string;
  backend: "cli" | "api";
}

/** The connections with one more Azure DevOps organization; the first is `ado`. */
export function withAzureDevOps(connections: readonly ConnectionConfig[], form: AzureDevOpsForm): ConnectionConfig[] {
  const id = connectionId("ado", connections.map((c) => c.id));
  const organization = form.organization.trim().toLowerCase();
  return [...connections, { id, kind: "azure-devops", backend: form.backend, host: "dev.azure.com", organization }];
}

/** The connections without one; the daemon refuses removing the last one or one a source needs. */
export function withoutConnection(connections: readonly ConnectionConfig[], id: string): ConnectionConfig[] {
  return connections.filter((c) => c.id !== id);
}

/** A configured connection with where the running daemon says it stands; none until a restart. */
export interface ConnectionRow {
  config: ConnectionConfig;
  host: string;
  status?: ConnectionStatus;
}

export function connectionRows(status: Status | undefined, settings: Settings | undefined): ConnectionRow[] {
  const running = status?.connections ?? [];
  return configuredConnections(settings).map((config) => {
    const s = running.find((c) => c.id === config.id);
    const host = config.kind === "azure-devops" ? `${config.host}/${config.organization}` : hostOfConnection(config);
    return { config, host, ...(s ? { status: s } : {}) };
  });
}

/** The settings name connections the running daemon does not have yet: a restart applies them. */
export function restartPending(status: Status | undefined, settings: Settings | undefined): boolean {
  if (!status?.connections || !settings) return false;
  const running = status.connections.map((c) => `${c.id}@${c.host ?? ""}`).sort().join(",");
  const configured = configuredConnections(settings).map((c) => `${c.id}@${hostOfConnection(c)}`).sort().join(",");
  return running !== configured;
}
