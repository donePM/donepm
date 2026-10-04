import type { ZodType } from "zod";
import type { Done } from "../providers/result.js";
import type { FetchedIssue, FetchResult } from "../providers/ticket-source.js";
import type { Exec } from "../process/exec.js";
import { IssueStateSchema, ListIssuesSchema, SearchIssuesSchema, toSourceIssue } from "./schema.js";

export const ISSUE_LIMIT = "1000";

export type { FetchResult };

type Parsed<T> = { ok: true; value: T } | { ok: false; kind: "schema"; error: string; raw: string };

export function parseJson<T>(schema: ZodType<T, any, any>, raw: string): Parsed<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, kind: "schema", error: `not JSON: ${(e as Error).message}`, raw };
  }
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const error = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return { ok: false, kind: "schema", error, raw };
}

/** Old `gh` versions have no `gh search issues`. */
export function isUnknownCommand(stderr: string): boolean {
  return /unknown command/i.test(stderr);
}

/**
 * Spec 6.2: open issues assigned to the current user. Uses `gh search issues`; if that command
 * does not exist, falls back to `gh issue list` per known repository (`host/owner/repo`).
 */
export async function fetchAssignedIssues(exec: Exec, knownRepos: () => string[]): Promise<FetchResult> {
  const r = await exec("gh", [
    "search", "issues", "--assignee=@me", "--state=open",
    "--json", "id,number,title,body,createdAt,labels,repository,url", "--limit", ISSUE_LIMIT,
  ]);
  if (r.code !== 0) {
    if (isUnknownCommand(r.stderr)) return listPerRepo(exec, knownRepos());
    return { ok: false, kind: "command", error: r.stderr.trim() || `gh exited with ${r.code}` };
  }
  const parsed = parseJson(SearchIssuesSchema, r.stdout);
  if (!parsed.ok) return parsed;
  return { ok: true, issues: parsed.value.map((i) => toSourceIssue(i, i.repository.nameWithOwner)) };
}

/**
 * Issue #32: the open issues of one repository matching a query pasted from GitHub's issue search.
 * `--repo` pins the repository, so a query cannot reach into others; pull requests are excluded.
 */
export async function fetchQueryIssues(exec: Exec, origin: string, query: string): Promise<FetchResult> {
  const r = await exec("gh", [
    "issue", "list", "--repo", origin, "--search", query, "--state", "open",
    "--json", "id,number,title,body,createdAt,labels,url", "--limit", ISSUE_LIMIT,
  ]);
  if (r.code !== 0) return { ok: false, kind: "command", error: r.stderr.trim() || `gh exited with ${r.code}` };
  const parsed = parseJson(ListIssuesSchema, r.stdout);
  if (!parsed.ok) return parsed;
  return { ok: true, issues: parsed.value.map((i) => toSourceIssue(i, repositoryOfUrl(i.url) ?? repositoryOf(origin))) };
}

/**
 * `Owner/Repo` as GitHub spells it, from the issue URL. Origins are lower case, but `externalId`
 * keeps GitHub's spelling; the same issue from search and from a query must get the same id.
 */
function repositoryOfUrl(url: string): string | undefined {
  const [owner, repo] = new URL(url).pathname.split("/").filter(Boolean);
  return owner && repo ? `${owner}/${repo}` : undefined;
}

/** `owner/repo` from `host/owner/repo`. */
function repositoryOf(origin: string): string {
  return origin.split("/").slice(1).join("/");
}

async function listPerRepo(exec: Exec, origins: string[]): Promise<FetchResult> {
  const issues: FetchedIssue[] = [];
  for (const origin of [...new Set(origins)]) {
    const repository = repositoryOf(origin);
    const r = await exec("gh", [
      "issue", "list", "--assignee", "@me", "--state", "open", "--repo", origin,
      "--json", "id,number,title,body,createdAt,labels,url", "--limit", ISSUE_LIMIT,
    ]);
    if (r.code !== 0) return { ok: false, kind: "command", error: `${origin}: ${r.stderr.trim()}` };
    const parsed = parseJson(ListIssuesSchema, r.stdout);
    if (!parsed.ok) return parsed;
    issues.push(...parsed.value.map((i) => toSourceIssue(i, repository)));
  }
  return { ok: true, issues };
}

/**
 * `OPEN` / `CLOSED`, or undefined when gh fails or the issue cannot be read. A merged pull request
 * (an item to review, D40) counts as closed.
 */
export async function fetchIssueState(
  exec: Exec,
  repository: string,
  number: number,
): Promise<"OPEN" | "CLOSED" | undefined> {
  const r = await exec("gh", ["issue", "view", String(number), "--repo", repository, "--json", "state"]);
  if (r.code !== 0) return undefined;
  const parsed = parseJson(IssueStateSchema, r.stdout);
  if (!parsed.ok) return undefined;
  return parsed.value.state === "OPEN" ? "OPEN" : "CLOSED";
}

/** Assign an issue to the gh user. Only the daemon calls this, on start, when the repo opted in. */
export async function assignIssueToMe(
  exec: Exec,
  repository: string,
  number: number,
): Promise<Done> {
  const r = await exec("gh", ["issue", "edit", String(number), "--repo", repository, "--add-assignee", "@me"]);
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || `gh exited with ${r.code}` };
}
