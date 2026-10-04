import type { DraftReply, FeedbackEntry } from "../api/types";

/** "Reply to @ana on src/a.ts:12", or a plain PR comment when the reply answers no thread. */
export function replyTarget(reply: DraftReply, feedback: readonly FeedbackEntry[]): string {
  if (reply.inReplyTo === undefined) return "Comment on the pull request";
  const first = feedback.find((e) => e.kind === "inline" && e.id === reply.inReplyTo);
  const any = first ?? feedback.find((e) => e.kind === "inline" && e.thread === reply.inReplyTo);
  if (!any) return `Reply in thread ${reply.inReplyTo}`;
  const where = any.path ? ` on ${any.path}${any.line ? `:${any.line}` : ""}` : "";
  return `Reply to @${any.author}${where}`;
}
