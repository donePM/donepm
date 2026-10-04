import type { ConnectionState } from "../status/status.js";
import type { JiraClient } from "./client.js";

export interface JiraHealth {
  state: ConnectionState;
  detail?: string;
}

/** The account the token signs in as (`GET /myself`): ready, unauthorized or unreachable. */
export async function jiraHealth(client: JiraClient): Promise<JiraHealth> {
  const r = await client.call("GET", `/rest/api/${client.apiVersion}/myself`);
  if (r.ok) {
    const me = r.body as { displayName?: unknown; emailAddress?: unknown; name?: unknown } | undefined;
    const who = [me?.displayName, me?.emailAddress, me?.name].find((v): v is string => typeof v === "string" && v.length > 0);
    return who ? { state: "ready", detail: who } : { state: "ready" };
  }
  if (r.failure === "no_token" || r.failure === "unauthorized") return { state: "unauthorized", detail: r.error };
  return { state: "unreachable", detail: r.error };
}

export interface JiraTest extends JiraHealth {
  ok: boolean;
  /** What `serverInfo` says the site is, when it answered. */
  deployment?: "cloud" | "datacenter";
}

/**
 * "Test connection" in Settings (D51): asks `serverInfo` what the site is, so a Cloud site set up
 * as Data Center (or the other way round) is named instead of failing as a bare 401, then checks
 * the token with `/myself`.
 */
export async function testJira(client: JiraClient): Promise<JiraTest> {
  const info = await client.call("GET", "/rest/api/2/serverInfo");
  if (!info.ok && (info.failure === "unreachable" || info.failure === "no_token")) return { ok: false, ...(await jiraHealth(client)) };
  let deployment: "cloud" | "datacenter" | undefined;
  const type = info.ok ? (info.body as { deploymentType?: unknown } | undefined)?.deploymentType : undefined;
  if (typeof type === "string") deployment = type.toLowerCase() === "cloud" ? "cloud" : "datacenter";
  const seen = deployment ? { deployment } : {};
  if (deployment && deployment !== client.config.deployment) {
    const name = deployment === "cloud" ? "Jira Cloud" : "Jira Data Center";
    return { ok: false, state: "unauthorized", detail: `${client.config.baseUrl} is ${name}: set the deployment to ${deployment}`, ...seen };
  }
  const health = await jiraHealth(client);
  return { ok: health.state === "ready", ...health, ...seen };
}
