import { normalizeOriginUrl } from "@donepm/core";
import type { AzureDevOpsConnectionConfig, JiraConnectionConfig, RepoView, Settings, TicketSourceSettings } from "../../api/types";

/** The daemon's queries when an entry has none (packages/daemon/src/config/ticket-sources.ts). */
export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done";
export const DEFAULT_WIQL =
  "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Completed', 'Cut') ORDER BY [System.ChangedDate] DESC";
export const DEFAULT_PROJECT_WIQL = DEFAULT_WIQL.replace(" WHERE ", " WHERE [System.TeamProject] = @project AND ");

export type TicketConnection = JiraConnectionConfig | AzureDevOpsConnectionConfig;

/** The Jira connections a ticket source can query. */
export function jiraConnections(settings: Settings | undefined): JiraConnectionConfig[] {
  return (settings?.connections ?? []).filter((c): c is JiraConnectionConfig => c.kind === "jira");
}

/** The connections a ticket source can query: Jira sites and Azure DevOps organizations (issue #142). */
export function ticketConnections(settings: Settings | undefined): TicketConnection[] {
  return (settings?.connections ?? []).filter((c): c is TicketConnection => c.kind === "jira" || c.kind === "azure-devops");
}

/** The query language of a connection, for the field's name. */
export const queryLanguage = (kind: TicketConnection["kind"] | undefined): string => (kind === "azure-devops" ? "WIQL" : "JQL");

/** The query an entry without one runs. */
export function defaultQuery(kind: TicketConnection["kind"] | undefined, project?: string): string {
  if (kind !== "azure-devops") return DEFAULT_JQL;
  return project?.trim() ? DEFAULT_PROJECT_WIQL : DEFAULT_WIQL;
}

/** Jira's own issue search with the query, to compare with what donePM finds. */
export function jiraSearchUrl(baseUrl: string, jql: string | undefined): string {
  return `${baseUrl.replace(/\/+$/, "")}/issues/?jql=${encodeURIComponent(jql?.trim() || DEFAULT_JQL)}`;
}

/** The repositories a ticket can go to: the local clones, by normalised origin, sorted. */
export function repoOrigins(repos: readonly RepoView[] | undefined): string[] {
  return [...new Set((repos ?? []).map((r) => normalizeOriginUrl(r.originUrl)))].sort();
}

const DEFAULTS = new Set([DEFAULT_JQL, DEFAULT_WIQL, DEFAULT_PROJECT_WIQL]);

/** An entry as saved: a blank query is the default, the project and the flag only when set. */
export function cleanEntry(entry: TicketSourceSettings): TicketSourceSettings {
  const query = entry.query?.trim();
  const project = entry.project?.trim();
  return {
    connection: entry.connection,
    ...(project ? { project } : {}),
    ...(query && !DEFAULTS.has(query) ? { query } : {}),
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
  if (!entry.connection) return "Choose a connection";
  if (entry.repos.length === 0) return "Choose at least one repository its tickets are worked in";
  return undefined;
}
