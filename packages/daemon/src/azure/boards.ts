import { azureWorkItemUrl, isFinishedCategory, parseAzureDevOpsOrigin, parseTicketId } from "@donepm/core";
import { z } from "zod";
import { queryOf, type TicketSourceConfig } from "../config/ticket-sources.js";
import { parseJson } from "../gh/issues.js";
import type { Done } from "../providers/result.js";
import type { FetchResult, Search, TicketRef, TicketSource, TicketState } from "../providers/ticket-source.js";
import { seg, type AzureTransport } from "./transport.js";
import {
  queryIds, readWorkItems, STATE_FIELDS, stateCatalog, toTicket, WORK_ITEM_FIELDS,
  type AzureRead, type AzureWorkItem, type StateCatalog,
} from "./work-items.js";

/** The comments API is still a preview at 7.1; it is the one that takes Markdown. */
const COMMENTS_API_VERSION = "7.1-preview.4";

const ConnectionDataSchema = z
  .object({ authenticatedUser: z.object({ properties: z.object({ Account: z.object({ $value: z.string() }).passthrough() }).passthrough() }).passthrough() })
  .passthrough();
const CommentSchema = z.object({ id: z.number().optional(), commentId: z.number().optional() }).passthrough();

export interface AzureBoardsOptions {
  /** The connection's id, the first part of every ticket id (`ado:1234`). */
  id: string;
  organization: string;
}

/**
 * Azure Boards as a ticket source (issue #142, D57): one WIQL query per `ticketSources` entry of
 * this connection, the work items read in one batch, each going to the union of the repositories
 * of the entries that found it. A work item whose state is in a finished category (`Completed`,
 * `Removed`) is not collected and closes its item. Reads and writes go through the connection's
 * transport, `az rest` or the REST API with a token; writes only after the user's click or approval.
 */
export function azureBoards(transport: AzureTransport, o: AzureBoardsOptions, entries: () => readonly TicketSourceConfig[]): TicketSource {
  const catalog: StateCatalog = stateCatalog(transport);

  const numberOf = (ticket: TicketRef): number | undefined => {
    const t = parseTicketId(ticket.externalId);
    return t && t.connection === o.id && /^\d+$/.test(t.key) ? Number(t.key) : undefined;
  };

  const isFinished = async (item: AzureWorkItem): Promise<boolean | undefined> => {
    const { "System.TeamProject": project, "System.WorkItemType": type, "System.State": state } = item.fields;
    if (!type || !state) return undefined;
    const category = await catalog.categoryOf(project, type, state);
    return category === undefined ? undefined : isFinishedCategory(category);
  };

  /** The open ones of these work items; one whose category cannot be read counts as open. */
  const open = async (items: readonly AzureWorkItem[]): Promise<AzureWorkItem[]> => {
    const out: AzureWorkItem[] = [];
    for (const item of items) if ((await isFinished(item)) !== true) out.push(item);
    return out;
  };

  /** The open work items a query matches, as tickets going to `origins`. */
  const run = async (wiql: string, project: string | undefined, origins: readonly string[]): Promise<FetchResult> => {
    const ids = await queryIds(transport, wiql, project);
    if (!ids.ok) return failure(ids);
    const items = await readWorkItems(transport, ids.value, WORK_ITEM_FIELDS);
    if (!items.ok) return failure(items);
    return { ok: true, issues: (await open(items.value)).map((w) => toTicket(w, o.id, o.organization, origins)) };
  };

  const statesOf = async (refs: readonly TicketRef[]): Promise<Map<string, TicketState>> => {
    const out = new Map<string, TicketState>();
    const ids = [...new Set(refs.flatMap((r) => numberOf(r) ?? []))];
    if (ids.length === 0) return out;
    const items = await readWorkItems(transport, ids, STATE_FIELDS);
    if (!items.ok) return out;
    for (const item of items.value) {
      const finished = await isFinished(item);
      if (finished !== undefined) out.set(`${o.id}:${item.id}`, finished ? "CLOSED" : "OPEN");
    }
    return out;
  };

  /** The project a work item is in, which the comments and states APIs need in their path. */
  const itemOf = async (n: number): Promise<AzureRead<AzureWorkItem>> => {
    const r = await readWorkItems(transport, [n], STATE_FIELDS);
    if (!r.ok) return r;
    const item = r.value[0];
    return item ? { ok: true, value: item } : { ok: false, kind: "command", error: `work item ${n} cannot be read in ${o.organization}` };
  };

  const update = async (n: number, field: string, value: string): Promise<Done> => {
    const r = await transport({
      method: "PATCH",
      path: `_apis/wit/workitems/${n}`,
      body: [{ op: "add", path: `/fields/${field}`, value }],
      contentType: "application/json-patch+json",
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };

  const notMine = (ticket: TicketRef) => ({ ok: false as const, error: `${ticket.externalId} is not a work item of ${o.id}` });

  const comment: NonNullable<TicketSource["comment"]> = async (ticket, markdown) => {
    const n = numberOf(ticket);
    if (n === undefined) return notMine(ticket);
    const item = await itemOf(n);
    if (!item.ok) return { ok: false, error: item.error };
    const project = item.value.fields["System.TeamProject"];
    const r = await transport({
      method: "POST",
      path: `${seg(project)}/_apis/wit/workItems/${n}/comments`,
      query: { format: "markdown", "api-version": COMMENTS_API_VERSION },
      body: { text: markdown },
    });
    if (!r.ok) return { ok: false, error: r.error };
    const parsed = parseJson(CommentSchema, r.body);
    const id = parsed.ok ? (parsed.value.id ?? parsed.value.commentId) : undefined;
    return { ok: true, id: id === undefined ? "" : String(id), url: azureWorkItemUrl(o.organization, project, n) };
  };

  return {
    async collect() {
      const mine = entries().filter((e) => e.connection === o.id);
      const found: Array<{ entry: TicketSourceConfig; ids: AzureRead<number[]> }> = [];
      for (const entry of mine) found.push({ entry, ids: await queryIds(transport, queryOf(entry, "azure-devops"), entry.project) });
      // Every entry's work items in one batch, each going to the repositories of all entries that found it.
      const origins = new Map<number, Set<string>>();
      for (const { entry, ids } of found) {
        if (!ids.ok) continue;
        for (const id of ids.value) origins.set(id, new Set([...(origins.get(id) ?? []), ...entry.repos]));
      }
      const read = await readWorkItems(transport, [...origins.keys()], WORK_ITEM_FIELDS);
      const byId = new Map<number, AzureWorkItem>();
      if (read.ok) for (const item of await open(read.value)) byId.set(item.id, item);
      return found.map(({ entry, ids }, i): Search => {
        const label = i === 0 ? {} : { label: `Azure Boards ${short(queryOf(entry, "azure-devops"))}` };
        if (!ids.ok) return { ...label, result: failure(ids) };
        if (!read.ok) return { ...label, result: failure(read) };
        const issues = ids.value.flatMap((id) => {
          const item = byId.get(id);
          return item ? [toTicket(item, o.id, o.organization, [...origins.get(id)!])] : [];
        });
        return { ...label, result: { ok: true, issues } };
      });
    },
    async query(origin, wiql) {
      // A repository's query runs in its own project when it is an Azure Repos one of this organization.
      const repo = parseAzureDevOpsOrigin(origin);
      const project = repo?.organization === o.organization ? repo.project : undefined;
      return run(wiql, project, origin ? [origin] : []);
    },
    async withFields(issues) {
      return [...issues];
    },
    async state(ticket) {
      return (await statesOf([ticket])).get(ticket.externalId);
    },
    states: statesOf,
    async assignToMe(ticket) {
      const n = numberOf(ticket);
      if (n === undefined) return notMine(ticket);
      const me = await transport({ method: "GET", path: "_apis/connectionData", query: { "api-version": "7.1-preview" } });
      if (!me.ok) return { ok: false, error: me.error };
      const who = parseJson(ConnectionDataSchema, me.body);
      if (!who.ok) return { ok: false, error: "Azure DevOps did not say who is signed in" };
      return update(n, "System.AssignedTo", who.value.authenticatedUser.properties.Account.$value);
    },
    comment,
    async transitions(ticket) {
      const n = numberOf(ticket);
      if (n === undefined) return notMine(ticket);
      const item = await itemOf(n);
      if (!item.ok) return { ok: false, error: item.error };
      const { "System.TeamProject": project, "System.WorkItemType": type, "System.State": state } = item.value.fields;
      if (!type) return { ok: false, error: `work item ${n} has no type` };
      const states = await catalog.states(project, type);
      if (!states.ok) return { ok: false, error: states.error };
      // Azure Boards lets a work item go to any state of its type; the process fills in the reason.
      return {
        ok: true,
        transitions: states.value
          .filter((s) => s.name.toLowerCase() !== state?.toLowerCase())
          .map((s) => ({ id: s.name, name: s.name, toStatus: s.name, requiredFields: [] })),
      };
    },
    async transition(ticket, to, text) {
      const n = numberOf(ticket);
      if (n === undefined) return notMine(ticket);
      const moved = await update(n, "System.State", to);
      if (!moved.ok || !text) return moved;
      // The comments API is the one that takes Markdown, so the comment is a second call.
      const posted = await comment(ticket, text);
      return posted.ok ? { ok: true } : { ok: false, error: `moved to ${to}, but the comment failed: ${posted.error}` };
    },
  };
}

function failure(r: Exclude<AzureRead<unknown>, { ok: true }>): FetchResult {
  return r.kind === "schema" ? { ok: false, kind: "schema", error: r.error, raw: r.raw } : { ok: false, kind: "command", error: r.error };
}

const short = (wiql: string) => (wiql.length > 64 ? `"${wiql.slice(0, 63)}…"` : `"${wiql}"`);
