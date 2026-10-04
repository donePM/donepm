import type { SourceSettings } from "../api/types";

/** What GitHub's issue search shows for the default source (assigned to me, open). */
export const DEFAULT_QUERY = "is:issue state:open assignee:@me";

/**
 * The sources map with one repository's query and assign opt-in replaced; its `ignored` flag stays.
 * An entry that says nothing beyond the defaults (no query, no assign, not ignored) is dropped, so
 * the config stays small.
 */
export function withSource(
  sources: Readonly<Record<string, SourceSettings>>,
  origin: string,
  next: { query: string; assignOnStart: boolean },
): Record<string, SourceSettings> {
  const { [origin]: old, ...rest } = sources;
  const query = next.query.trim();
  const ignored = old?.ignored === true;
  if (!query && !next.assignOnStart && !ignored) return rest;
  return { ...rest, [origin]: { ...(query ? { query } : {}), assignOnStart: next.assignOnStart, ...(ignored ? { ignored } : {}) } };
}

/** The repository's issue list on GitHub, filtered by the query, to refine it there. */
export function issueSearchUrl(origin: string, query: string): string {
  return `https://${origin}/issues?q=${encodeURIComponent(query.trim() || DEFAULT_QUERY)}`;
}
