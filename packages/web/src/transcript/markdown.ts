import type { Row } from "./rows";

/**
 * Rows whose text renders as Markdown: what the agent wrote and the task it was given. The user's
 * own messages, thinking, tool input and output and setup logs stay plain text.
 */
export function rendersMarkdown(row: Row): boolean {
  return row.type === "text" || row.type === "task";
}
