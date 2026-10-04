import type { ItemView } from "../api/types";
import { columnOf } from "../board/columns";

/** Items waiting for the user: the Needs You column (state `needs_you` or `failed`). Archived items never count. */
export function needsYouCount(items: readonly ItemView[]): number {
  return items.filter((i) => i.archivedAt === undefined && columnOf(i) === "needs_you").length;
}

/** "1 item needs you" / "3 items need you". */
export function needsYouLabel(count: number): string {
  return count === 1 ? "1 item needs you" : `${count} items need you`;
}

/** The pill's text: "3 need you" (the label above is the accessible name). */
export function needsYouShort(count: number): string {
  return `${count} need${count === 1 ? "s" : ""} you`;
}
