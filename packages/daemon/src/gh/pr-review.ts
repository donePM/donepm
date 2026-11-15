import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewDraftPayload } from "@donepm/core";
import { z } from "zod";
import type { ReviewResult } from "../providers/code-host.js";
import type { Exec } from "../process/exec.js";
import { parseJson } from "./issues.js";

const REVIEW_TIMEOUT_MS = 60_000;

/** The part of GitHub's answer to `POST /repos/{owner}/{repo}/pulls/{n}/reviews` the daemon keeps. */
export const PullReviewSchema = z.object({ id: z.number(), html_url: z.string() });

export type { ReviewResult };

/**
 * Post an approved review of someone else's pull request (decision D43), as the user, never from
 * the agent's process. One request carries the verdict, the body and every inline comment, pinned
 * to the commit the agent reviewed. The JSON goes through a 0600 temp file, not argv.
 */
export async function postReview(exec: Exec, review: ReviewDraftPayload): Promise<ReviewResult> {
  const u = new URL(review.url);
  const [owner, name] = u.pathname.split("/").filter(Boolean);
  if (!owner || !name) return { ok: false, error: `not a pull request URL: ${review.url}` };
  const request = {
    commit_id: review.commitId,
    event: review.verdict,
    body: review.body,
    comments: review.comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body })),
  };
  const dir = mkdtempSync(join(tmpdir(), "donepm-review-"));
  try {
    const input = join(dir, "review.json");
    writeFileSync(input, JSON.stringify(request), { mode: 0o600 });
    const r = await exec(
      "gh",
      ["api", "--hostname", u.host, "--method", "POST", `repos/${owner}/${name}/pulls/${review.number}/reviews`, "--input", input],
      { timeoutMs: REVIEW_TIMEOUT_MS },
    );
    if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim() || `gh exited with ${r.code}` };
    // The review is posted; an answer that does not parse must not turn into a retry that posts twice.
    const parsed = parseJson(PullReviewSchema, r.stdout);
    return { ok: true, result: parsed.ok ? { id: parsed.value.id, url: parsed.value.html_url } : { id: 0, url: review.url } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
