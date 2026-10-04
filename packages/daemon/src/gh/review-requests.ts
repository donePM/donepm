import type { Exec } from "../process/exec.js";
import { ISSUE_LIMIT, isUnknownCommand, parseJson, type FetchResult } from "./issues.js";
import { SearchIssuesSchema, toSourceIssue } from "./schema.js";

/**
 * Issue #48, D40: open pull requests that ask for the user's review, as `github-pr` items. `gh
 * search prs` answers in the same shape as `gh search issues`. An old `gh` without the command
 * gives no review requests rather than an error: the issues still come in.
 */
export async function fetchReviewRequests(exec: Exec): Promise<FetchResult> {
  const r = await exec("gh", [
    "search", "prs", "--review-requested=@me", "--state=open",
    "--json", "number,title,body,createdAt,labels,repository,url", "--limit", ISSUE_LIMIT,
  ]);
  if (r.code !== 0) {
    if (isUnknownCommand(r.stderr)) return { ok: true, issues: [] };
    return { ok: false, kind: "command", error: r.stderr.trim() || `gh exited with ${r.code}` };
  }
  const parsed = parseJson(SearchIssuesSchema, r.stdout);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    issues: parsed.value.map((i) => ({ ...toSourceIssue(i, i.repository.nameWithOwner), source: "github-pr" as const })),
  };
}
