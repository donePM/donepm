import { azureDevOpsConnection } from "../azure/connection.js";
import type { ConnectionConfig } from "../config/connections.js";
import { gitHubCliConnection } from "../gh/adapter.js";
import { jiraConnection } from "../jira/connection.js";
import type { Exec } from "../process/exec.js";
import type { HttpClient } from "./http.js";
import type { TokenStore } from "./keychain.js";
import { providerRegistry, type Connection, type Providers } from "./registry.js";

/** What adapters need: `exec` for a `cli` backend, `http` and the Keychain's `tokens` for an `api` one. */
export interface ProviderDeps {
  exec: Exec;
  http: HttpClient;
  tokens: TokenStore;
}

/** The adapters of one configured connection (D50). The schema refuses a backend a kind lacks. */
function connectionOf(config: ConnectionConfig, deps: ProviderDeps): Connection {
  switch (config.kind) {
    case "github":
      return gitHubCliConnection(deps.exec, config.host, config.id);
    case "jira":
      return jiraConnection(config, deps.http, deps.tokens);
    case "azure-devops":
      return azureDevOpsConnection({ ...deps, id: config.id, organization: config.organization, backend: config.backend });
  }
}

/** The registry of a config's connections, read once at start (D50). */
export function providersOf(connections: readonly ConnectionConfig[], deps: ProviderDeps): Providers {
  return providerRegistry(connections.map((c) => connectionOf(c, deps)));
}
