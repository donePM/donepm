import type { WorkItem } from "@donepm/core";

export interface PrKind {
  text: string;
  title: string;
}

/**
 * The card's label for someone else's pull request (D40, D47): `PR · dependabot`, `PR · octo`.
 * A bot's `[bot]` suffix is dropped; GitHub shows the app's name the same way.
 */
export function prKind(item: Pick<WorkItem, "source" | "author">): PrKind | undefined {
  if (item.source !== "github-pr") return undefined;
  if (!item.author) return { text: "PR", title: "A pull request assigned to you or asking for your review" };
  const name = item.author.replace(/\[bot\]$/, "");
  return { text: `PR · ${name}`, title: `A pull request by ${item.author}, assigned to you or asking for your review` };
}
