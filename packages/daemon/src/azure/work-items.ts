import { azurePriorityTier, azureWorkItemUrl, ticketExternalId, workItemBody, workItemLabels } from "@donepm/core";
import { z } from "zod";
import { parseJson } from "../gh/issues.js";
import { descriptionMarkdown } from "../jira/search.js";
import type { FetchedIssue } from "../providers/ticket-source.js";
import { seg, type AzureTransport } from "./transport.js";

/** The fields a collected work item is read with (issue #142). The text fields are HTML. */
export const WORK_ITEM_FIELDS = [
  "System.Id", "System.TeamProject", "System.WorkItemType", "System.State", "System.Title", "System.CreatedDate", "System.Tags",
  "System.Description", "Microsoft.VSTS.Common.AcceptanceCriteria", "Microsoft.VSTS.TCM.ReproSteps", "Microsoft.VSTS.Common.Priority",
];

/** What deciding a work item's state takes. */
export const STATE_FIELDS = ["System.Id", "System.TeamProject", "System.WorkItemType", "System.State"];

/** `workitemsbatch` takes at most this many ids per call. */
const IDS_PER_BATCH = 200;
/** A query that matches more work items than this is cut short (`$top`). */
const MAX_RESULTS = 200;

const text = z.string().nullish();
const Ref = z.object({ id: z.number().int() }).passthrough();

const WiqlSchema = z
  .object({
    workItems: z.array(Ref).nullish(),
    /** A tree or one-hop query answers links; their targets are the work items. */
    workItemRelations: z.array(z.object({ target: Ref.nullish() }).passthrough()).nullish(),
  })
  .passthrough();

export const AzureWorkItemSchema = z
  .object({
    id: z.number().int(),
    fields: z
      .object({
        "System.TeamProject": z.string(),
        "System.WorkItemType": text,
        "System.State": text,
        "System.Title": text,
        "System.CreatedDate": text,
        "System.Tags": text,
        "System.Description": text,
        "Microsoft.VSTS.Common.AcceptanceCriteria": text,
        "Microsoft.VSTS.TCM.ReproSteps": text,
        "Microsoft.VSTS.Common.Priority": z.unknown().optional(),
      })
      .passthrough(),
    _links: z.object({ html: z.object({ href: z.string() }).passthrough().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export type AzureWorkItem = z.infer<typeof AzureWorkItemSchema>;

/** `errorPolicy: omit` answers a work item it cannot read (deleted, no access) as `null`. */
const BatchSchema = z.object({ value: z.array(AzureWorkItemSchema.nullable()) }).passthrough();

const StatesSchema = z.object({ value: z.array(z.object({ name: z.string(), category: text }).passthrough()) }).passthrough();

export type AzureRead<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "command"; error: string }
  | { ok: false; kind: "schema"; error: string; raw: string };

const schemaFailure = (error: string, raw: string) => ({ ok: false as const, kind: "schema" as const, error: `unexpected Azure DevOps answer: ${error}`, raw });

/**
 * The ids a WIQL query matches, in its order (issue #142): in the project when one is named, so
 * `@project` works, else across the organization. A link query's targets, each once.
 */
export async function queryIds(transport: AzureTransport, wiql: string, project?: string): Promise<AzureRead<number[]>> {
  const r = await transport({
    method: "POST",
    path: `${project ? `${seg(project)}/` : ""}_apis/wit/wiql`,
    query: { $top: String(MAX_RESULTS) },
    body: { query: wiql },
  });
  if (!r.ok) return { ok: false, kind: "command", error: r.error };
  const parsed = parseJson(WiqlSchema, r.body);
  if (!parsed.ok) return schemaFailure(parsed.error, r.body);
  const refs = parsed.value.workItems ?? (parsed.value.workItemRelations ?? []).flatMap((rel) => (rel.target ? [rel.target] : []));
  return { ok: true, value: [...new Set(refs.map((w) => w.id))] };
}

/**
 * The work items with these ids, `IDS_PER_BATCH` at a time, in the order asked. One that cannot be
 * read is left out. Stops at the first failed call.
 */
export async function readWorkItems(transport: AzureTransport, ids: readonly number[], fields: readonly string[]): Promise<AzureRead<AzureWorkItem[]>> {
  const out: AzureWorkItem[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_BATCH) {
    const r = await transport({
      method: "POST",
      path: "_apis/wit/workitemsbatch",
      body: { ids: ids.slice(i, i + IDS_PER_BATCH), fields, errorPolicy: "omit" },
    });
    if (!r.ok) return { ok: false, kind: "command", error: r.error };
    const parsed = parseJson(BatchSchema, r.body);
    if (!parsed.ok) return schemaFailure(parsed.error, r.body);
    for (const item of parsed.value.value) if (item) out.push(item);
  }
  const byId = new Map(out.map((w) => [w.id, w]));
  return { ok: true, value: ids.flatMap((id) => byId.get(id) ?? []) };
}

/** A work item type's states, in the process's order, with their categories. */
export type TypeStates = ReadonlyArray<{ name: string; category?: string }>;

/**
 * The states of a work item type per project, read once and kept (issue #142): the category of a
 * state is what tells finished from open, whatever the process calls it. A state the kept list
 * does not know (added to the process since) reads the list again.
 */
export function stateCatalog(transport: AzureTransport) {
  const kept = new Map<string, TypeStates>();
  const read = async (project: string, type: string): Promise<AzureRead<TypeStates>> => {
    const r = await transport({ method: "GET", path: `${seg(project)}/_apis/wit/workitemtypes/${seg(type)}/states` });
    if (!r.ok) return { ok: false, kind: "command", error: r.error };
    const parsed = parseJson(StatesSchema, r.body);
    if (!parsed.ok) return schemaFailure(parsed.error, r.body);
    const states = parsed.value.value.map((s) => (s.category ? { name: s.name, category: s.category } : { name: s.name }));
    kept.set(`${project.toLowerCase()}\n${type.toLowerCase()}`, states);
    return { ok: true, value: states };
  };
  const find = (states: TypeStates, state: string) => states.find((s) => s.name.toLowerCase() === state.toLowerCase());
  return {
    /** The type's states, from what is kept or read now. */
    async states(project: string, type: string): Promise<AzureRead<TypeStates>> {
      const states = kept.get(`${project.toLowerCase()}\n${type.toLowerCase()}`);
      return states ? { ok: true, value: states } : read(project, type);
    },
    /** The category of a state; undefined when it cannot be read. */
    async categoryOf(project: string, type: string, state: string): Promise<string | undefined> {
      const states = kept.get(`${project.toLowerCase()}\n${type.toLowerCase()}`);
      const known = states && find(states, state);
      if (known) return known.category;
      const fresh = await read(project, type);
      return fresh.ok ? find(fresh.value, state)?.category : undefined;
    },
  };
}

export type StateCatalog = ReturnType<typeof stateCatalog>;

/** A work item as a ticket of connection `connection` going to `origins` (issue #142). */
export function toTicket(item: AzureWorkItem, connection: string, organization: string, origins: readonly string[]): FetchedIssue {
  const f = item.fields;
  const created = f["System.CreatedDate"] ? new Date(f["System.CreatedDate"]) : undefined;
  return {
    repository: f["System.TeamProject"],
    number: item.id,
    externalId: ticketExternalId(connection, String(item.id)),
    source: "ado-work-item",
    url: item._links?.html?.href ?? azureWorkItemUrl(organization, f["System.TeamProject"], item.id),
    title: f["System.Title"] ?? `#${item.id}`,
    body: workItemBody({
      description: descriptionMarkdown(f["System.Description"]),
      acceptanceCriteria: descriptionMarkdown(f["Microsoft.VSTS.Common.AcceptanceCriteria"]),
      reproSteps: descriptionMarkdown(f["Microsoft.VSTS.TCM.ReproSteps"]),
    }),
    labels: workItemLabels(f["System.Tags"], f["System.WorkItemType"]),
    createdAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : new Date(0).toISOString(),
    priorityTier: azurePriorityTier(f["Microsoft.VSTS.Common.Priority"]),
    origins: [...origins],
  };
}
