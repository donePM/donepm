import { GITHUB_COM } from "@donepm/core";
import type { Exec } from "../process/exec.js";
import { hostEnv } from "./hosts.js";
import { ISSUE_LIMIT, isUnknownCommand, parseJson, type FetchResult } from "./issues.js";
import { SearchPrsSchema, toSourceIssue } from "./schema.js";

/** Which pull requests a search asks for. */
export type PrQualifier = "--review-requested=@me" | "--assignee=@me";

/**
 * Open pull requests of others as `github-pr` items: those that ask for the user's review (issue
 * #48, D40) and those assigned to the user, Dependabot's included (issue #98, D47). `gh search prs`
 * answers in the shape of `gh search issues` plus the author; one host per call (issue #140). An old `gh` without the command gives
 * no pull requests rather than an error: the issues still come in.
 */
export async function fetchPullRequests(exec: Exec, qualifier: PrQualifier, host: string = GITHUB_COM): Promise<FetchResult> {
  const r = await exec("gh", [
    "search", "prs", qualifier, "--state=open",
    "--json", "number,title,body,createdAt,labels,repository,url,author", "--limit", ISSUE_LIMIT,
  ], hostEnv(host));
  if (r.code !== 0) {
    if (isUnknownCommand(r.stderr)) return { ok: true, issues: [] };
    return { ok: false, kind: "command", error: r.stderr.trim() || `gh exited with ${r.code}` };
  }
  const parsed = parseJson(SearchPrsSchema, r.stdout);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    issues: parsed.value.map((pr) => ({
      ...toSourceIssue(pr, pr.repository.nameWithOwner),
      source: "github-pr" as const,
      ...(pr.author ? { author: pr.author.login } : {}),
    })),
  };
}
