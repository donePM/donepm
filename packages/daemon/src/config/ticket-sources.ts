import { normalizeOriginUrl } from "@donepm/core";
import { z } from "zod";
import type { ConnectionConfig } from "./connections.js";

/** What a Jira ticket source searches without a query of its own (issue #139). */
export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done";

const Origin = z
  .string()
  .trim()
  .refine((k) => /^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(k) && normalizeOriginUrl(k) === k, { message: "must be a normalised origin like github.com/owner/repo" });

/**
 * One search of a ticket provider (issue #139): its tickets go to `repos`. One repository is the
 * ticket's; of several the user chooses per ticket. A ticket several searches find may go to any
 * of their repositories.
 */
export const TicketSourceSchema = z
  .object({
    /** The id of a ticket connection (`jira`). */
    connection: z.string().min(1),
    /** JQL. Missing: `DEFAULT_JQL`. */
    query: z.string().trim().min(1).optional(),
    repos: z.array(Origin).min(1, "name at least one repository"),
    /** Assign the ticket to the user when they press Start (D28). Off. */
    assignOnStart: z.boolean().optional(),
  })
  .strict();

export type TicketSourceConfig = z.infer<typeof TicketSourceSchema>;

export const TicketSourcesSchema = z.array(TicketSourceSchema);

/** Kinds whose tickets come through `ticketSources` rather than their repositories' own issues. */
const TICKET_KINDS = new Set(["jira"]);

/** Why a ticket source cannot be: its connection is missing or has no tickets of this kind. */
export function ticketSourceProblem(entry: TicketSourceConfig, connections: readonly ConnectionConfig[]): string | undefined {
  const c = connections.find((x) => x.id === entry.connection);
  if (!c) return `no connection ${entry.connection}`;
  if (!TICKET_KINDS.has(c.kind)) return `${entry.connection} is a ${c.kind} connection; its issues come through "sources"`;
  return undefined;
}

/** The query of an entry, with the default filled in. */
export const queryOf = (entry: TicketSourceConfig): string => entry.query ?? DEFAULT_JQL;
