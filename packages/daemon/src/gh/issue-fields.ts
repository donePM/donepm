import type { SourceIssue } from "@donepm/core";
import { z } from "zod";
import type { Exec } from "../process/exec.js";
import type { FetchedIssue } from "./schema.js";

/** GitHub resolves at most 100 ids per `nodes` call. */
export const FIELDS_BATCH = 100;

/** Global node ids are base64url-ish; anything else is not inlined into a query. */
const NODE_ID = /^[A-Za-z0-9_=-]+$/;

/** The field donePM reads (D45), compared case-insensitively. */
const PRIORITY_FIELD = "priority";

/** A value whose type the query does not select (date, text, …) comes back as `{}`. */
const FieldValue = z
  .object({ name: z.string().optional(), field: z.object({ name: z.string().optional() }).passthrough().nullish() })
  .passthrough();
const IssueNode = z
  .object({ id: z.string().optional(), issueFieldValues: z.object({ nodes: z.array(FieldValue.nullable()) }).nullish() })
  .passthrough();
/** `gh api graphql` with `nodes(ids:)`. A node GitHub cannot resolve is `null`, next to an `errors` entry. */
export const IssueFieldsSchema = z
  .object({ data: z.object({ nodes: z.array(IssueNode.nullable()) }).nullish() })
  .passthrough();

export function issueFieldsQuery(ids: readonly string[]): string {
  return (
    `query { nodes(ids: ${JSON.stringify(ids)}) { ... on Issue { id issueFieldValues(first: 20) { nodes { ` +
    "... on IssueFieldSingleSelectValue { name field { ... on IssueFieldSingleSelect { name } } } } } } } }"
  );
}

/** A GitHub without issue fields (GHES, older API) rejects the query; that is "no fields", not a failure. */
function isUnsupported(text: string): boolean {
  return /issueFieldValues|IssueFieldSingleSelect/.test(text) && /doesn't exist|undefinedField|unknown type/i.test(text);
}

/**
 * The option of the "Priority" issue field per issue node id (D45): the option's name, or null when
 * the issue has none. An id missing from the map could not be read (gh failed, the node did not
 * resolve); its item keeps the priority it has. One `gh api graphql` call per 100 issues, so the
 * poll costs the same number of calls however many issues it brings.
 */
export async function fetchPriorityFields(exec: Exec, ids: readonly string[]): Promise<Map<string, string | null>> {
  const read = new Map<string, string | null>();
  const valid = [...new Set(ids)].filter((id) => NODE_ID.test(id));
  for (let i = 0; i < valid.length; i += FIELDS_BATCH) {
    const batch = valid.slice(i, i + FIELDS_BATCH);
    const r = await exec("gh", ["api", "graphql", "-f", `query=${issueFieldsQuery(batch)}`]);
    if (r.code !== 0 && isUnsupported(`${r.stdout}\n${r.stderr}`)) {
      for (const id of batch) read.set(id, null);
      continue;
    }
    let parsed: z.infer<typeof IssueFieldsSchema> | undefined;
    try {
      const result = IssueFieldsSchema.safeParse(JSON.parse(r.stdout));
      if (result.success) parsed = result.data;
    } catch {
      // gh failed without a body: nothing of this batch was read.
    }
    // gh exits 1 when one id does not resolve, but answers for all the others.
    for (const node of parsed?.data?.nodes ?? []) {
      if (!node?.id) continue;
      const priority = node.issueFieldValues?.nodes.find((v) => v?.field?.name?.toLowerCase() === PRIORITY_FIELD && v.name);
      read.set(node.id, priority?.name ?? null);
    }
  }
  return read;
}

/**
 * The polled issues with their "Priority" issue field (D45). Pull requests have no issue fields and
 * keep the labels. An issue whose fields could not be read is marked `priorityUnread`.
 */
export async function withPriorityFields(exec: Exec, issues: readonly FetchedIssue[]): Promise<SourceIssue[]> {
  const ids = issues.flatMap((i) => (i.source !== "github-pr" && i.nodeId ? [i.nodeId] : []));
  const fields = ids.length ? await fetchPriorityFields(exec, ids) : new Map<string, string | null>();
  return issues.map(({ nodeId, ...issue }) => {
    if (issue.source === "github-pr" || nodeId === undefined) return issue;
    if (!fields.has(nodeId)) return { ...issue, priorityUnread: true };
    const option = fields.get(nodeId);
    return option ? { ...issue, priorityField: option } : issue;
  });
}
