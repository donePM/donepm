import type { SourceIssue } from "@donepm/core";
import type { Done } from "./result.js";

/** A collected ticket plus the provider's handle to read its fields later in one batch (D45). */
export type FetchedIssue = SourceIssue & { nodeId?: string };

/** One search or query of a poll. `schema`: the provider answered, but not in the expected shape. */
export type FetchResult =
  | { ok: true; issues: FetchedIssue[] }
  | { ok: false; kind: "command"; error: string }
  | { ok: false; kind: "schema"; error: string; raw: string };

/** One of a ticket source's default searches; `label` names it in the poll status. */
export interface Search {
  label?: string;
  result: FetchResult;
}

/** Whether a ticket is still open upstream. */
export type TicketState = "OPEN" | "CLOSED";

/** A ticket as an item names it: its `externalId` and the normalised origin it belongs to. */
export interface TicketRef {
  externalId: string;
  origin: string;
}

/**
 * Where tickets come from (issue #138): the default searches, a repository's own query, the
 * fields read in one batch after the searches, whether a ticket is closed, and assigning it on
 * Start. It fetches, validates and normalises; what follows from a ticket is decided in `core`.
 * Methods that write are called by the daemon after the user's click or approval, never from MCP.
 */
export interface TicketSource {
  /**
   * The default searches (spec 6.2), in a fixed order. The first is the main one: when it fails as
   * a command the user may have logged out, and the connection is detected again.
   */
  collect(knownOrigins: () => string[]): Promise<Search[]>;
  /** The open tickets of one repository matching a query pasted from the provider's search (#32). */
  query(origin: string, query: string): Promise<FetchResult>;
  /** The tickets with the fields read in a batch (priority, D45); one whose fields could not be read says so. */
  withFields(issues: readonly FetchedIssue[]): Promise<SourceIssue[]>;
  /** `OPEN` or `CLOSED`; undefined when it cannot be read. */
  state(ticket: TicketRef): Promise<TicketState | undefined>;
  /** The states of many tickets in few calls, by `externalId`; one left out could not be read. */
  states?(tickets: readonly TicketRef[]): Promise<Map<string, TicketState>>;
  /** Assign the ticket to the logged-in user (D28). */
  assignToMe(ticket: TicketRef): Promise<Done>;
}
