import { stripVTControlCharacters } from "node:util";
import type { CheckLog, CiCheck, PrDraftResult } from "@donepm/core";
import type { Exec } from "../process/exec.js";
import { parseJson } from "./issues.js";
import { prRepository } from "./pr-state.js";
import { PrChecksSchema } from "./schema.js";

export type PrChecks = { ok: true; checks: CiCheck[] } | { ok: false; error: string };

const FIELDS = "name,state,bucket,link,workflow,startedAt,completedAt";

/**
 * The checks of a pull request (decision D35). `gh pr checks` exits 8 while checks are pending and
 * 1 when one failed, yet prints the JSON either way, so stdout counts, not the exit code. A PR that
 * has no checks (yet) makes gh exit 1 with "no checks reported"; that is an empty list.
 */
export async function fetchPrChecks(exec: Exec, pr: PrDraftResult): Promise<PrChecks> {
  const repository = prRepository(pr.url);
  if (!repository) return { ok: false, error: `not a pull request URL: ${pr.url}` };
  const r = await exec("gh", ["pr", "checks", String(pr.number), "--repo", repository, "--json", FIELDS]);
  if (/no checks reported/i.test(r.stderr)) return { ok: true, checks: [] };
  if (!r.stdout.trim()) return { ok: false, error: r.stderr.trim() || `gh exited with ${r.code}` };
  const parsed = parseJson(PrChecksSchema, r.stdout);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, checks: parsed.value.map(withoutUndefined) };
}

/** How many lines of each failed job's log travel to the card and the agent. */
export const LOG_TAIL_LINES = 40;

/**
 * The ends of the failed jobs' logs of one Actions run (`gh run view --log-failed`), one entry per
 * job, named like its check. Lines come as `job<TAB>step<TAB>timestamp text`; the timestamp and
 * colour codes go. Any failure gives no logs: they help, but CI's verdict does not depend on them.
 */
export async function fetchFailedLogs(exec: Exec, repository: string, runId: string, tailLines = LOG_TAIL_LINES): Promise<CheckLog[]> {
  const r = await exec("gh", ["run", "view", runId, "--repo", repository, "--log-failed"]);
  if (r.code !== 0) return [];
  const jobs = new Map<string, string[]>();
  for (const raw of r.stdout.replace(/^\uFEFF/, "").split("\n")) {
    const [job, , rest] = raw.split("\t", 3) as [string, string?, string?];
    if (rest === undefined) continue;
    const text = stripVTControlCharacters(rest.replace(/^\uFEFF/, "")).replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
    const lines = jobs.get(job) ?? [];
    lines.push(text.trimEnd());
    jobs.set(job, lines);
  }
  return [...jobs].map(([name, lines]) => ({ name, tail: lines.slice(-tailLines).join("\n") }));
}

function withoutUndefined(c: CiCheck): CiCheck {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as unknown as CiCheck;
}
