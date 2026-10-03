import type { Repo, WorkItem } from "@donepm/core";

export type ItemBadge = "no-local-clone" | "closed-upstream";

/** What the API returns for an item: the item, its clone (if any) and display badges. */
export interface ItemView extends WorkItem {
  repo: Pick<Repo, "id" | "path" | "originUrl" | "defaultBranch"> | null;
  badges: ItemBadge[];
}

export function toItemView(item: WorkItem, repo: Repo | undefined): ItemView {
  const badges: ItemBadge[] = [];
  if (!repo) badges.push("no-local-clone");
  if (item.closedUpstream) badges.push("closed-upstream");
  return {
    ...item,
    repo: repo ? { id: repo.id, path: repo.path, originUrl: repo.originUrl, defaultBranch: repo.defaultBranch } : null,
    badges,
  };
}
