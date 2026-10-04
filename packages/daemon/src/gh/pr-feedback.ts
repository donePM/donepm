import type { FeedbackEntry, PrDraftResult } from "@donepm/core";
import { z } from "zod";
import type { PrFeedbackResult } from "../providers/code-host.js";
import type { Exec } from "../process/exec.js";
import { parseJson } from "./issues.js";

/**
 * Reviews, inline comments and conversation comments of one pull request, in one GraphQL call.
 * `gh pr view --json` has no inline comments and does not tell bots from people; `__typename` does.
 */
export const FEEDBACK_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      author { login }
      reviews(last: 100) {
        nodes {
          databaseId state body submittedAt url author { login __typename }
          comments(first: 100) {
            nodes { databaseId body path line originalLine diffHunk url createdAt replyTo { databaseId } author { login __typename } }
          }
        }
      }
      comments(last: 100) { nodes { databaseId body createdAt url author { login __typename } } }
    }
  }
}`;

/** A deleted account comes back as `null`. */
const Author = z.object({ login: z.string(), __typename: z.string().optional() }).nullable();

const InlineSchema = z.object({
  databaseId: z.number().int(),
  body: z.string(),
  path: z.string(),
  line: z.number().int().nullable(),
  originalLine: z.number().int().nullable(),
  diffHunk: z.string(),
  url: z.string(),
  createdAt: z.string(),
  replyTo: z.object({ databaseId: z.number().int() }).nullable(),
  author: Author,
});

const ReviewSchema = z.object({
  databaseId: z.number().int(),
  state: z.string(),
  body: z.string(),
  submittedAt: z.string().nullable(),
  url: z.string(),
  author: Author,
  comments: z.object({ nodes: z.array(InlineSchema) }),
});

const CommentSchema = z.object({
  databaseId: z.number().int(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
  author: Author,
});

export const PrFeedbackSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        author: Author,
        reviews: z.object({ nodes: z.array(ReviewSchema) }),
        comments: z.object({ nodes: z.array(CommentSchema) }),
      }),
    }),
  }),
});

export type { PrFeedbackResult };

/** Owner, name and host of a pull request URL such as `https://github.com/owner/repo/pull/45`. */
function prRepo(url: string): { host: string; owner: string; name: string } | undefined {
  const u = new URL(url);
  const [owner, name, kind] = u.pathname.split("/").filter(Boolean);
  return owner && name && kind === "pull" ? { host: u.host, owner, name } : undefined;
}

/** The feedback on a PR donePM opened that may need the agent (decision D39), oldest first. */
export async function fetchPrFeedback(exec: Exec, pr: PrDraftResult): Promise<PrFeedbackResult> {
  const repo = prRepo(pr.url);
  if (!repo) return { ok: false, error: `not a pull request URL: ${pr.url}` };
  const r = await exec("gh", [
    "api", "graphql", "--hostname", repo.host,
    "-F", `owner=${repo.owner}`, "-F", `name=${repo.name}`, "-F", `number=${pr.number}`,
    "-f", `query=${FEEDBACK_QUERY}`,
  ]);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || `gh exited with ${r.code}` };
  const parsed = parseJson(PrFeedbackSchema, r.stdout);
  return parsed.ok ? { ok: true, entries: feedbackEntries(parsed.value) } : { ok: false, error: parsed.error };
}

/**
 * What counts (D39): reviews that request changes or say something, inline comments and
 * conversation comments, by people other than the PR's author. The author is the user, and
 * donePM's replies are posted as them. Bots are left out: they comment after every push and the
 * item would never stay done. Approvals, dismissed and pending reviews are not feedback.
 */
export function feedbackEntries(raw: z.infer<typeof PrFeedbackSchema>): FeedbackEntry[] {
  const pull = raw.data.repository.pullRequest;
  const me = pull.author?.login;
  const counts = (a: z.infer<typeof Author>): a is NonNullable<z.infer<typeof Author>> =>
    a !== null && a.login !== me && a.__typename !== "Bot";
  const entries: FeedbackEntry[] = [];
  for (const review of pull.reviews.nodes) {
    if (review.state !== "CHANGES_REQUESTED" && review.state !== "COMMENTED") continue;
    if (counts(review.author) && (review.state === "CHANGES_REQUESTED" || review.body.trim())) {
      entries.push({
        kind: "review", id: review.databaseId, author: review.author.login, body: review.body, url: review.url,
        at: review.submittedAt ?? "", state: review.state,
      });
    }
    for (const c of review.comments.nodes) {
      if (!counts(c.author)) continue;
      const line = c.line ?? c.originalLine;
      entries.push({
        kind: "inline", id: c.databaseId, author: c.author.login, body: c.body, url: c.url, at: c.createdAt,
        path: c.path, ...(line !== null ? { line } : {}), diffHunk: c.diffHunk, thread: c.replyTo?.databaseId ?? c.databaseId,
      });
    }
  }
  for (const c of pull.comments.nodes) {
    if (!counts(c.author)) continue;
    entries.push({ kind: "comment", id: c.databaseId, author: c.author.login, body: c.body, url: c.url, at: c.createdAt });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
