import type { ItemView } from "../api/types";

/**
 * The archive list (D37): newest archived first, narrowed to items whose title or external id
 * contains every word of the query, ignoring case. An empty query keeps everything.
 */
export function filterArchive(items: readonly ItemView[], query: string): ItemView[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (i: ItemView) => {
    const text = `${i.title} ${i.externalId}`.toLowerCase();
    return words.every((w) => text.includes(w));
  };
  return items.filter(matches).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}
