import {
  draftCreated, draftTitle, type ReviewComment, type ReviewDraft, type ReviewVerdict, type WorkItem,
} from "@donepm/core";
import { parsePatch } from "diff";
import type { Exec } from "../process/exec.js";
import { issueNumber } from "../worktrees/create.js";
import { DraftError, draftableItem, type DraftDeps } from "./actions.js";

export interface ReviewInput {
  verdict: ReviewVerdict;
  body: string;
  comments: ReviewComment[];
}

/**
 * `draft_review` (decision D43): the agent's review of someone else's pull request. The daemon adds
 * the PR and the head commit the agent read, and checks that every inline comment sits on a line
 * of the diff, where GitHub accepts it. The user approves; the daemon posts it as the user.
 */
export async function createReviewDraft(deps: DraftDeps & { exec: Exec }, itemId: string, input: ReviewInput): Promise<ReviewDraft> {
  const item = draftableItem(deps, itemId);
  if (item.source !== "github-pr") throw new DraftError(409, "draft_review is only for a pull request under review");
  if (!item.worktreePath) throw new DraftError(409, "the item has no worktree");
  const body = input.body.trim();
  if (!body && input.verdict !== "APPROVE") throw new DraftError(409, `a ${input.verdict} review needs a body`);

  const git = (...args: string[]) => deps.exec("git", ["-C", item.worktreePath!, ...args]);
  const head = await git("rev-parse", "HEAD");
  if (head.code !== 0) throw new DraftError(409, `cannot read the reviewed commit: ${head.stderr.trim()}`);
  if (input.comments.length) {
    const base = await baseOf(deps, item);
    const diff = await git("diff", "--no-color", "--no-ext-diff", "--no-prefix", `origin/${base}...HEAD`);
    if (diff.code !== 0) throw new DraftError(409, `cannot read the diff: ${diff.stderr.trim()}`);
    checkComments(input.comments, commentableLines(diff.stdout));
  }

  const draft: ReviewDraft = {
    id: deps.ctx.newId(),
    itemId,
    type: "review",
    payload: {
      number: issueNumber(item.externalId), url: item.externalUrl, commitId: head.stdout.trim(),
      verdict: input.verdict, body, comments: input.comments.map((c) => ({ path: c.path, line: c.line, body: c.body })),
    },
    state: "pending",
  };
  // Re-read: git ran meanwhile and the agent may have ended its turn.
  const current = draftableItem(deps, itemId);
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(current, deps.ctx, draft.id, { type: "review", title: draftTitle(draft) }));
  return draft;
}

async function baseOf(deps: DraftDeps, item: WorkItem): Promise<string> {
  if (item.baseBranch) return item.baseBranch;
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo) throw new DraftError(409, "the item has no local clone");
  return repo.defaultBranch;
}

/**
 * The lines of the new version a review comment can sit on, per file: every added or unchanged
 * line inside a hunk (GitHub's `side: RIGHT`). Expects `git diff --no-prefix`.
 */
export function commentableLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  for (const patch of parsePatch(diff)) {
    const path = patch.newFileName;
    if (!path || path === "/dev/null") continue;
    const lines = files.get(path) ?? new Set<number>();
    for (const hunk of patch.hunks) {
      let n = hunk.newStart;
      for (const line of hunk.lines) {
        if (line.startsWith("+") || line.startsWith(" ")) lines.add(n++);
      }
    }
    files.set(path, lines);
  }
  return files;
}

function checkComments(comments: ReviewComment[], lines: Map<string, Set<number>>): void {
  for (const c of comments) {
    const file = lines.get(c.path);
    if (!file) throw new DraftError(409, `${c.path} is not changed by this pull request; comment only on changed files`);
    if (!file.has(c.line)) {
      throw new DraftError(409, `line ${c.line} of ${c.path} is not in the diff; comment only on lines inside its hunks, or put it in the body`);
    }
  }
}
