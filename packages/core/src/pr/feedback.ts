import type { Event } from "../event/types.js";
import type { CiPr } from "../item/transitions.js";

/**
 * One piece of review feedback on a pull request donePM opened (decision D39): a review that asks
 * for changes or says something, an inline comment on the diff, or a comment in the conversation.
 */
export interface FeedbackEntry {
  kind: "review" | "inline" | "comment";
  /** GitHub's database id; unique within its kind. */
  id: number;
  author: string;
  body: string;
  url: string;
  at: string;
  /** Review: `CHANGES_REQUESTED` or `COMMENTED`. */
  state?: string;
  /** Inline: the file and line the comment is on, and GitHub's diff hunk up to that line. */
  path?: string;
  line?: number;
  diffHunk?: string;
  /** Inline: the id of the thread's first comment, which replies go to. */
  thread?: number;
}

/** What a feedback entry is known by across polls, e.g. `inline:4165356352`. */
export function feedbackKey(e: Pick<FeedbackEntry, "kind" | "id">): string {
  return `${e.kind}:${e.id}`;
}

/** Feedback the user has not seen yet: every entry not in an earlier `pr.feedback` event. */
export function newFeedback(entries: readonly FeedbackEntry[], events: readonly Event[]): FeedbackEntry[] {
  const seen = new Set(feedbackEntries(events).map(feedbackKey));
  return entries.filter((e) => !seen.has(feedbackKey(e)));
}

/** Every entry the `pr.feedback` events recorded, oldest first. */
export function feedbackEntries(events: readonly Event[]): FeedbackEntry[] {
  return events.filter((e) => e.type === "pr.feedback").flatMap((e) => entriesOf(e.payload.entries));
}

/** Review feedback the item waits on: the last `pr.feedback` while nothing moved after it. */
export interface PrFeedback {
  pr: CiPr;
  entries: FeedbackEntry[];
  waiting: boolean;
}

const MOVES = /^(ci|agent|draft|pr)\./;

export function prFeedbackOf(events: readonly Event[]): PrFeedback | undefined {
  const last = events.findLast((e) => e.type === "pr.feedback");
  if (!last) return undefined;
  const p = last.payload;
  if (typeof p.number !== "number" || typeof p.url !== "string") return undefined;
  return {
    pr: { number: p.number, url: p.url },
    entries: entriesOf(p.entries),
    waiting: events.findLast((e) => MOVES.test(e.type)) === last,
  };
}

function entriesOf(raw: unknown): FeedbackEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is FeedbackEntry =>
      typeof e === "object" && e !== null && typeof e.kind === "string" && typeof e.id === "number" && typeof e.body === "string",
  );
}

/** Comment ids an inline reply may go to: the threads of every inline entry recorded. */
export function replyThreads(events: readonly Event[]): Set<number> {
  return new Set(feedbackEntries(events).flatMap((e) => (e.kind === "inline" ? [e.thread ?? e.id] : [])));
}

const HUNK_LINES = 12;

/**
 * The message that resumes the agent on review feedback. The agent has no network: everything it
 * needs is in here, and its answers go out as replies on a draft the user approves.
 */
export function feedbackFixPrompt(f: Pick<PrFeedback, "pr" | "entries">): string {
  const lines = [`Pull request #${f.pr.number} got review feedback:`];
  for (const e of f.entries) {
    lines.push("");
    if (e.kind === "review") {
      const what = e.state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed";
      lines.push(`### @${e.author} ${what}`);
    } else if (e.kind === "inline") {
      lines.push(`### @${e.author} on \`${e.path ?? "?"}${e.line ? `:${e.line}` : ""}\` (thread ${e.thread ?? e.id})`);
      if (e.diffHunk) lines.push("```diff", ...e.diffHunk.split("\n").slice(-HUNK_LINES), "```");
    } else {
      lines.push(`### @${e.author} commented`);
    }
    if (e.body.trim()) lines.push(e.body.trim());
  }
  lines.push(
    "",
    "Address what you agree with: change the code, commit, run the build and the tests.",
    "Then call draft_push with a summary. Answer reviewers in its `replies`: give `inReplyTo` the thread number to reply on an inline comment, leave it out for a comment on the pull request.",
    "If nothing needs to change, call draft_comment with your replies instead.",
    "The user reviews everything before it is pushed or posted.",
  );
  return lines.join("\n");
}
