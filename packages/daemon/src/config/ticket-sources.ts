import { normalizeOriginUrl, parseAzureDevOpsOrigin } from "@donepm/core";
import { z } from "zod";
import type { ConnectionConfig } from "./connections.js";

/** What a Jira ticket source searches without a query of its own (issue #139). */
export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done";

/**
 * What an Azure Boards ticket source queries without a query of its own (issue #142, D57): the
 * work items assigned to the user, leaving out the finished state names of the built-in processes.
 * WIQL cannot ask for a state category, so a finished state of a custom process is filtered out
 * after the query by its category.
 */
export const DEFAULT_WIQL =
  "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Completed', 'Cut') ORDER BY [System.ChangedDate] DESC";

/** `DEFAULT_WIQL` within the entry's project. */
export const DEFAULT_PROJECT_WIQL = DEFAULT_WIQL.replace(" WHERE ", " WHERE [System.TeamProject] = @project AND ");

const Origin = z
  .string()
  .trim()
  .refine((k) => normalizeOriginUrl(k) === k && (/^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(k) || parseAzureDevOpsOrigin(k) !== undefined), {
    message: "must be a normalised origin like github.com/owner/repo or dev.azure.com/org/project/repo",
  });

/**
 * One search of a ticket provider (issue #139): its tickets go to `repos`. One repository is the
 * ticket's; of several the user chooses per ticket. A ticket several searches find may go to any
 * of their repositories.
 */
export const TicketSourceSchema = z
  .object({
    /** The id of a ticket connection (`jira`). */
    connection: z.string().min(1),
    /** JQL for Jira, WIQL for Azure Boards. Missing: `DEFAULT_JQL`, `DEFAULT_WIQL`. */
    query: z.string().trim().min(1).optional(),
    /** Azure Boards only: the project the query runs in, so `@project` works. Missing: the whole organization. */
    project: z.string().trim().min(1).optional(),
    repos: z.array(Origin).min(1, "name at least one repository"),
    /** Assign the ticket to the user when they press Start (D28). Off. */
    assignOnStart: z.boolean().optional(),
  })
  .strict();

export type TicketSourceConfig = z.infer<typeof TicketSourceSchema>;

export const TicketSourcesSchema = z.array(TicketSourceSchema);

/** Kinds whose tickets come through `ticketSources` rather than their repositories' own issues. */
const TICKET_KINDS = new Set(["jira", "azure-devops"]);

/** Why a ticket source cannot be: its connection is missing or has no tickets of this kind. */
export function ticketSourceProblem(entry: TicketSourceConfig, connections: readonly ConnectionConfig[]): string | undefined {
  const c = connections.find((x) => x.id === entry.connection);
  if (!c) return `no connection ${entry.connection}`;
  if (!TICKET_KINDS.has(c.kind)) return `${entry.connection} is a ${c.kind} connection; its issues come through "sources"`;
  if (entry.project !== undefined && c.kind !== "azure-devops") return `"project" is for Azure Boards; ${entry.connection} is a ${c.kind} connection`;
  return undefined;
}

/** The query of an entry, with its provider's default filled in. */
export function queryOf(entry: TicketSourceConfig, kind: "jira" | "azure-devops" = "jira"): string {
  if (entry.query) return entry.query;
  if (kind === "jira") return DEFAULT_JQL;
  return entry.project ? DEFAULT_PROJECT_WIQL : DEFAULT_WIQL;
}
