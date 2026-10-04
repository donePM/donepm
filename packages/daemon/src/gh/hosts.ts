import { hostOfOrigin } from "@donepm/core";
import type { Providers } from "../providers/registry.js";

/**
 * The GitHub hosts donePM works with through `gh` (issue #140): the host of each `github`
 * connection. github.com is the one there is without a `connections` config; a GitHub Enterprise
 * host (Server or GHE.com) is one more `gitHubCliConnection(exec, host, id)`.
 */
export function githubHosts(providers: Providers): string[] {
  const hosts = providers.connections.filter((c) => c.kind === "github" && c.host).map((c) => c.host!);
  return [...new Set(hosts)];
}

/** The origin (`host/owner/repo`) lives on one of the hosts. */
export function onHost(origin: string, hosts: readonly string[]): boolean {
  return hosts.includes(hostOfOrigin(origin));
}

/** `GH_HOST` for a `gh` command that takes no `--hostname` and no `--repo`, such as `gh search`. */
export function hostEnv(host: string): { env: Record<string, string> } {
  return { env: { GH_HOST: host } };
}
