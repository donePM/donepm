import type { PrDraftResult } from "@donepm/core";
import type { PrState } from "../providers/code-host.js";
import type { Exec } from "../process/exec.js";
import { parseJson } from "./issues.js";
import { PrStateSchema } from "./schema.js";

export type { PrState };

/** `host/owner/repo` from a pull request URL such as `https://github.com/owner/repo/pull/45`. */
export function prRepository(url: string): string | undefined {
  const u = new URL(url);
  const [owner, repo, kind] = u.pathname.split("/").filter(Boolean);
  return owner && repo && kind === "pull" ? `${u.host}/${owner}/${repo}` : undefined;
}

/**
 * The state of a pull request a donePM draft opened (spec 6.5): merged or not, and whether it can
 * still be merged into its base (D36). Checks come from `gh pr checks` (D35).
 */
export async function fetchPrState(exec: Exec, pr: PrDraftResult): Promise<PrState> {
  const repository = prRepository(pr.url);
  if (!repository) return { ok: false, error: `not a pull request URL: ${pr.url}` };
  const r = await exec("gh", ["pr", "view", String(pr.number), "--repo", repository, "--json", "state,mergedAt,mergeable,baseRefName"]);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || `gh exited with ${r.code}` };
  const parsed = parseJson(PrStateSchema, r.stdout);
  return parsed.ok ? { ok: true, ...parsed.value } : { ok: false, error: parsed.error };
}
