import { ApiError } from "../../api/client";
import type { MoveOutcome, WorktreeAtOldRoot } from "../../api/types";

/** The daemon refused to change the worktree root before the user chose what happens to these (#93). */
export function worktreesAtOldRoot(e: unknown): WorktreeAtOldRoot[] | undefined {
  if (!(e instanceof ApiError) || e.status !== 409) return undefined;
  const list = (e.body as { worktreesAtOldRoot?: WorktreeAtOldRoot[] } | undefined)?.worktreesAtOldRoot;
  return Array.isArray(list) && list.length ? list : undefined;
}

const worktrees = (n: number) => (n === 1 ? "1 worktree" : `${n} worktrees`);

export function moveQuestion(list: readonly WorktreeAtOldRoot[]): { title: string; note?: string } {
  const n = list.length;
  const running = list.filter((w) => w.running).length;
  return {
    title: `${worktrees(n)} ${n === 1 ? "is" : "are"} in the old location. Move ${n === 1 ? "it" : "them"} to the new one?`,
    ...(running
      ? { note: `${running === 1 ? "1 has" : `${running} have`} a running agent and stay${running === 1 ? "s" : ""} where ${running === 1 ? "it is" : "they are"}.` }
      : {}),
  };
}

/** After Move: what moved and, per item, why the rest did not. */
export function moveResult(outcome: MoveOutcome): string {
  const moved = outcome.moved.length ? `Moved ${worktrees(outcome.moved.length)}.` : "Nothing moved.";
  if (!outcome.skipped.length) return `Saved. ${moved}`;
  return `Saved. ${moved} Not moved: ${outcome.skipped.map((s) => `${s.title} (${s.reason})`).join("; ")}.`;
}
