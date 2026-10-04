import { DEFAULT_PRIORITY_TIER, priorityName } from "@donepm/core";

export interface PriorityBadge {
  text: string;
  /** `urgent` for P0 and P1, `low` for P3. */
  tone: "urgent" | "low";
  title: string;
}

/** The card's priority badge (D45): P0, P1 or P3; the default P2 shows nothing. */
export function priorityBadge(priority: number): PriorityBadge | undefined {
  if (priority === DEFAULT_PRIORITY_TIER) return undefined;
  return {
    text: priorityName(priority),
    tone: priority < DEFAULT_PRIORITY_TIER ? "urgent" : "low",
    title: "Priority from GitHub: the issue's Priority field, else its labels",
  };
}
