import { normalizeOriginUrl } from "@donepm/core";
import type { JiraConnectionConfig, RepoView, Settings, TicketSourceSettings } from "../../api/types";

/** The daemon's query when an entry has none (packages/daemon/src/config/ticket-sources.ts). */
export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done";

/** The Jira connections a ticket source can query. */
export function jiraConnections(settings: Settings | undefined): JiraConnectionConfig[] {
  return (settings?.connections ?? []).filter((c): c is JiraConnectionConfig => c.kind === "jira");
}

/** Jira's own issue search with the query, to compare with what donePM finds. */
export function jiraSearchUrl(baseUrl: string, jql: string | undefined): string {
  return `${baseUrl.replace(/\/+$/, "")}/issues/?jql=${encodeURIComponent(jql?.trim() || DEFAULT_JQL)}`;
}

/** The repositories a ticket can go to: the local clones, by normalised origin, sorted. */
export function repoOrigins(repos: readonly RepoView[] | undefined): string[] {
  return [...new Set((repos ?? []).map((r) => normalizeOriginUrl(r.originUrl)))].sort();
}

/** An entry as saved: a blank query is the default, the flag only when on. */
export function cleanEntry(entry: TicketSourceSettings): TicketSourceSettings {
  const query = entry.query?.trim();
  return {
    connection: entry.connection,
    ...(query && query !== DEFAULT_JQL ? { query } : {}),
    repos: [...new Set(entry.repos)],
    ...(entry.assignOnStart ? { assignOnStart: true } : {}),
  };
}

/** The list with the entry at `index` replaced, or appended when `index` is undefined. */
export function withTicketSource(list: readonly TicketSourceSettings[], entry: TicketSourceSettings, index?: number): TicketSourceSettings[] {
  const clean = cleanEntry(entry);
  return index === undefined ? [...list, clean] : list.map((e, i) => (i === index ? clean : e));
}

export function withoutTicketSource(list: readonly TicketSourceSettings[], index: number): TicketSourceSettings[] {
  return list.filter((_, i) => i !== index);
}

/** What keeps an entry from being saved, before the daemon is asked. */
export function entryProblem(entry: TicketSourceSettings): string | undefined {
  if (!entry.connection) return "Choose a Jira connection";
  if (entry.repos.length === 0) return "Choose at least one repository its tickets are worked in";
  return undefined;
}
