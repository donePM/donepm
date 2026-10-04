import type { PrDraftResult } from "@donepm/core";
import type { Exec } from "../process/exec.js";
import { parseJson } from "./issues.js";
import { PrStateSchema } from "./schema.js";

export type PrState =
  | { ok: true; state: "OPEN" | "CLOSED" | "MERGED"; mergedAt: string | null }
  | { ok: false; error: string };

/** `host/owner/repo` from a pull request URL such as `https://github.com/owner/repo/pull/45`. */
export function prRepository(url: string): string | undefined {
  const u = new URL(url);
  const [owner, repo, kind] = u.pathname.split("/").filter(Boolean);
  return owner && repo && kind === "pull" ? `${u.host}/${owner}/${repo}` : undefined;
}

/**
 * The state of a pull request a donePM draft opened (spec 6.4). Only merged or not for now; review
 * comments and checks come later.
 */
export async function fetchPrState(exec: Exec, pr: PrDraftResult): Promise<PrState> {
  const repository = prRepository(pr.url);
  if (!repository) return { ok: false, error: `not a pull request URL: ${pr.url}` };
  const r = await exec("gh", ["pr", "view", String(pr.number), "--repo", repository, "--json", "state,mergedAt"]);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || `gh exited with ${r.code}` };
  const parsed = parseJson(PrStateSchema, r.stdout);
  return parsed.ok ? { ok: true, ...parsed.value } : { ok: false, error: parsed.error };
}
