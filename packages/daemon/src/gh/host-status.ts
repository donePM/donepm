import { GITHUB_COM } from "@donepm/core";
import type { Exec } from "../process/exec.js";
import type { Status, StatusStore } from "../status/status.js";
import { detectGh, type GhStatus } from "./detect.js";

/** Where `gh` stands for one GitHub host: `gh` for github.com, `ghHosts` for the others (issue #140). */
export function ghStatusOf(status: Status, host: string): GhStatus | undefined {
  return host === GITHUB_COM ? status.gh : status.ghHosts?.[host];
}

/** Detect `gh` for one host again and store it where `ghStatusOf` reads it. */
export async function detectHost(exec: Exec, status: StatusStore, host: string): Promise<GhStatus> {
  const gh = await detectGh(exec, host);
  if (host === GITHUB_COM) status.update({ gh });
  else status.update({ ghHosts: { ...status.get().ghHosts, [host]: gh } });
  return gh;
}

/** Detect every host; github.com's status stays in `gh`, the others replace `ghHosts`. */
export async function detectHosts(exec: Exec, hosts: readonly string[]): Promise<Pick<Status, "gh" | "ghHosts">> {
  const found = await Promise.all(hosts.map(async (host) => [host, await detectGh(exec, host)] as const));
  const others = found.filter(([host]) => host !== GITHUB_COM);
  return {
    gh: found.find(([host]) => host === GITHUB_COM)?.[1],
    ghHosts: others.length ? Object.fromEntries(others) : undefined,
  };
}
