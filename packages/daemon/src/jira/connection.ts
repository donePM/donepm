import type { JiraConnectionConfig } from "../config/connections.js";
import type { HttpClient } from "../providers/http.js";
import type { TokenStore } from "../providers/keychain.js";
import type { Connection } from "../providers/registry.js";
import { jiraClient } from "./client.js";
import { jiraHealth } from "./health.js";

/** A Jira site over its REST API (D51). Its host is its base URL's. */
export function jiraConnection(config: JiraConnectionConfig, http: HttpClient, tokens: TokenStore): Connection {
  const client = jiraClient(config, http, tokens);
  return {
    id: config.id,
    kind: "jira",
    backend: "api",
    host: new URL(config.baseUrl).host.toLowerCase(),
    health: () => jiraHealth(client),
  };
}
