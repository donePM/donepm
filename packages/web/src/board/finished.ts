import type { ItemView } from "../api/types";

/**
 * A finished card (done, and its PR merged if a draft opened one) is muted and offers no actions
 * but opening it, until the retention job moves it to the archive (D37).
 */
export function isFinished(item: Pick<ItemView, "state" | "finishedAt">): boolean {
  return item.state === "done" && item.finishedAt !== undefined;
}
