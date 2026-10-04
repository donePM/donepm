import { AZURE_DEVOPS_HOST } from "@donepm/core";
import { z } from "zod";
import { parseJson } from "../gh/issues.js";
import type { HttpClient } from "../providers/http.js";
import type { TokenStore } from "../providers/keychain.js";
import type { Backend, Connection } from "../providers/registry.js";
import type { Exec } from "../process/exec.js";
import type { ConnectionState } from "../status/status.js";
import { azureDevOpsCodeHost } from "./code-host.js";
import { azureApiTransport, azureCliTransport, type AzureTransport } from "./transport.js";

export interface AzureDevOpsConnectionOptions {
  id: string;
  organization: string;
  backend: Backend;
  exec: Exec;
  http: HttpClient;
  tokens: TokenStore;
}

type Health = { state: ConnectionState; detail?: string };

const AccountSchema = z.object({ user: z.object({ name: z.string() }).passthrough() }).passthrough();
const ConnectionDataSchema = z.object({ authenticatedUser: z.object({ providerDisplayName: z.string().optional() }).passthrough() }).passthrough();

/** `az` is there and logged in: `az --version`, then `az account show` for the account. */
export async function azureCliHealth(exec: Exec): Promise<Health> {
  const version = await exec("az", ["--version"]);
  if (version.code !== 0) return { state: "not_installed" };
  const account = await exec("az", ["account", "show", "--output", "json", "--only-show-errors"]);
  if (account.code !== 0) return { state: "not_logged_in", detail: "run az login" };
  const parsed = parseJson(AccountSchema, account.stdout);
  return parsed.ok ? { state: "ready", detail: parsed.value.user.name } : { state: "ready" };
}

/** The organization answers `_apis/connectionData` with the token, and says whose it is. */
export async function azureApiHealth(transport: AzureTransport): Promise<Health> {
  const r = await transport({ method: "GET", path: "_apis/connectionData", query: { "api-version": "7.1-preview" } });
  if (!r.ok) {
    if (r.reason === "unauthorized") return { state: "unauthorized", detail: r.error };
    return { state: "unreachable", detail: r.error };
  }
  const parsed = parseJson(ConnectionDataSchema, r.body);
  const name = parsed.ok ? parsed.value.authenticatedUser.providerDisplayName : undefined;
  return name ? { state: "ready", detail: name } : { state: "ready" };
}

/**
 * One Azure DevOps organization (issue #141): Azure Repos as its code host, through `az` or the
 * REST API with a personal access token. The daemon runs it; the agent never sees `az` or a token.
 */
export function azureDevOpsConnection(o: AzureDevOpsConnectionOptions): Connection {
  const transport = o.backend === "api" ? azureApiTransport(o.http, o.organization, o.tokens, o.id) : azureCliTransport(o.exec, o.organization);
  return {
    id: o.id,
    kind: "azure-devops",
    backend: o.backend,
    host: AZURE_DEVOPS_HOST,
    organization: o.organization,
    codeHost: azureDevOpsCodeHost(o.exec, transport),
    health: () => (o.backend === "api" ? azureApiHealth(transport) : azureCliHealth(o.exec)),
  };
}
