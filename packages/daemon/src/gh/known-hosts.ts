import { z } from "zod";
import type { Exec } from "../process/exec.js";

/** Without `--show-token`, gh's answer has no token field; donePM never asks for one. */
const AuthStatus = z.object({
  hosts: z.record(z.string(), z.array(z.object({ state: z.string(), active: z.boolean().optional() }).passthrough())),
});

/**
 * The GitHub hosts `gh` is logged in to, so Settings can offer each as a connection (issue #140).
 * With `--json`, gh exits 0 even when an account has a problem; only a working active account
 * counts. An old gh without `--json` answers nothing here.
 */
export async function ghKnownHosts(exec: Exec): Promise<string[]> {
  const r = await exec("gh", ["auth", "status", "--json", "hosts"]);
  if (r.code !== 0) return [];
  let parsed;
  try {
    parsed = AuthStatus.safeParse(JSON.parse(r.stdout));
  } catch {
    return [];
  }
  if (!parsed.success) return [];
  return Object.entries(parsed.data.hosts)
    .filter(([, accounts]) => accounts.some((a) => a.state === "success" && a.active !== false))
    .map(([host]) => host.toLowerCase())
    .sort();
}
