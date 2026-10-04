import { ghStatusOf } from "../gh/host-status.js";
import type { ConnectionStatus, Status } from "../status/status.js";
import type { TokenStore } from "./keychain.js";
import { providerRegistry, type Connection, type Providers } from "./registry.js";

/**
 * Where each connection stands (D50). A `cli` GitHub connection is where `gh` stands for its host;
 * an `api` connection is unauthorized until its token is in the Keychain, then what its provider
 * says of the token. The status says only whether a token is set, never the token.
 */
export async function connectionStatuses(connections: readonly Connection[], status: Status, tokens: TokenStore): Promise<ConnectionStatus[]> {
  return Promise.all(connections.map(async (c): Promise<ConnectionStatus> => {
    const base = { id: c.id, kind: c.kind, backend: c.backend, ...(c.host ? { host: c.host } : {}) };
    if (c.backend === "api") {
      if (!(await tokens.has(c.id))) return { ...base, tokenSet: false, state: "unauthorized", detail: "no API token in the Keychain" };
      const health = c.health ? await c.health() : { state: "ready" as const };
      return { ...base, tokenSet: true, ...health };
    }
    const gh = c.host ? ghStatusOf(status, c.host) : undefined;
    if (!gh) return { ...base, state: "not_installed" };
    return gh.account ? { ...base, state: gh.state, detail: gh.account } : { ...base, state: gh.state };
  }));
}

/**
 * Whether donePM can call a connection now. A `cli` GitHub connection needs `gh` logged in to its
 * host, as last detected; an `api` connection is tried and its failures reported at call time.
 */
export function isReady(status: Status, c: Connection): boolean {
  if (c.backend === "api") return true;
  return c.host !== undefined && ghStatusOf(status, c.host)?.state === "ready";
}

/** Only the connections donePM can call now, so the watchers skip the PRs of a host that is down. */
export function readyProviders(providers: Providers, status: Status): Providers {
  return providerRegistry(providers.connections.filter((c) => isReady(status, c)));
}
