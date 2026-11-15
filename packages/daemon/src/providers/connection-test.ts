import { azureDevOpsConnection } from "../azure/connection.js";
import type { ConnectionConfig } from "../config/connections.js";
import { detectGh } from "../gh/detect.js";
import { jiraClient } from "../jira/client.js";
import { testJira } from "../jira/health.js";
import type { ConnectionState } from "../status/status.js";
import type { ProviderDeps } from "./from-config.js";

export interface ConnectionTest {
  ok: boolean;
  state: ConnectionState;
  /** The account signed in, or what is wrong. Never a token. */
  detail?: string;
  /** Jira: what the site says it is (D51). */
  deployment?: "cloud" | "datacenter";
}

/**
 * The Test button of a connection in Settings: asks the provider now, with the connection as
 * saved, so it works before the restart that puts a new connection to use.
 */
export async function testConnection(config: ConnectionConfig, deps: ProviderDeps): Promise<ConnectionTest> {
  switch (config.kind) {
    case "github": {
      const gh = await detectGh(deps.exec, config.host);
      return { ok: gh.state === "ready", state: gh.state, ...(gh.account ? { detail: gh.account } : {}) };
    }
    case "jira":
      return testJira(jiraClient(config, deps.http, deps.tokens));
    case "azure-devops": {
      const c = azureDevOpsConnection({ ...deps, id: config.id, organization: config.organization, backend: config.backend });
      const health = await c.health!();
      return { ok: health.state === "ready", ...health };
    }
  }
}
