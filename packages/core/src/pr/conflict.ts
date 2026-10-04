import type { Event } from "../event/types.js";
import type { CiPr } from "../item/transitions.js";

/** An open pull request that can no longer be merged into its base (decision D36). */
export interface PrConflict {
  pr: CiPr;
  /** The PR's base branch, e.g. `main`. */
  base: string;
  /** Files that conflict, as `git merge-tree` reported them; empty when it could not tell. */
  files: string[];
  /** Where the item was when the conflict came up; it returns there once the conflict is gone. */
  from: "done" | "checking";
  /** The item waits in Needs You on it. False once the user took it on or the agent works on it. */
  waiting: boolean;
}

const MOVES = /^(ci|agent|draft|pr)\./;

/**
 * The conflict of the item's PR that GitHub has not reported resolved yet, from the last
 * `pr.conflicted`. It waits on the user while nothing moved after it.
 */
export function prConflictOf(events: readonly Event[]): PrConflict | undefined {
  const last = events.findLast((e) => e.type === "pr.conflicted" || e.type === "pr.conflict_resolved");
  if (last?.type !== "pr.conflicted") return undefined;
  const p = last.payload;
  if (typeof p.number !== "number" || typeof p.url !== "string") return undefined;
  const files = Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === "string") : [];
  return {
    pr: { number: p.number, url: p.url },
    base: typeof p.base === "string" ? p.base : "main",
    files,
    from: p.from === "checking" ? "checking" : "done",
    waiting: events.findLast((e) => MOVES.test(e.type)) === last,
  };
}

/**
 * The message that resumes the agent on a conflicting PR. The daemon fetched the base and the PR's
 * `branch` before, since the agent has no network. A merge, not a rebase: the push must not rewrite
 * what the PR has. The branch on GitHub can have commits the worktree lacks, e.g. from GitHub's
 * "Update branch"; merged first, they make the push a fast-forward (#119).
 */
export function conflictFixPrompt(c: Pick<PrConflict, "pr" | "base" | "files">, branch?: string): string {
  const fetched = branch ? `\`origin/${c.base}\` and \`origin/${branch}\` are` : `\`origin/${c.base}\` is`;
  const lines = [`Pull request #${c.pr.number} has merge conflicts with \`${c.base}\`. ${fetched} fetched and up to date.`];
  if (c.files.length) lines.push("", "Conflicting files:", ...c.files.map((f) => `- ${f}`));
  lines.push("");
  if (branch) lines.push(`First merge what the pull request has on GitHub and your branch not yet: \`git merge origin/${branch}\`.`);
  lines.push(
    `Merge the base into your branch with \`git merge origin/${c.base}\`. Do not rebase and do not force push. Resolve the conflicts and commit the merge.`,
    "Then run the build and the tests: a merge without conflicts can still break them.",
    "When they pass, call the draft_push tool so the user can push the merge to the pull request.",
  );
  return lines.join("\n");
}
