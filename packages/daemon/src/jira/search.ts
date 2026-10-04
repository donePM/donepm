import { jiraPriorityTier, splitTicketKey, ticketExternalId } from "@donepm/core";
import TurndownService from "turndown";
import { z } from "zod";
import type { FetchedIssue } from "../providers/ticket-source.js";
import type { JiraClient, JiraFailure } from "./client.js";

/** The fields a ticket is read with (issue #139); the description comes rendered as HTML. */
export const SEARCH_FIELDS = [
  "summary", "description", "priority", "status", "labels", "components", "issuetype", "project", "created", "updated", "assignee",
].join(",");

/** A page of a search; Jira caps it at 100 on both deployments. */
const PAGE_SIZE = 100;
/** A query that matches more than this many tickets is cut short, not read to the end. */
const MAX_PAGES = 10;

const Named = z.object({ name: z.string() }).passthrough();

export const JiraIssueSchema = z
  .object({
    key: z.string(),
    fields: z
      .object({
        summary: z.string().nullish(),
        priority: Named.nullish(),
        status: z.object({ name: z.string().optional(), statusCategory: z.object({ key: z.string() }).passthrough().optional() }).passthrough().nullish(),
        labels: z.array(z.string()).nullish(),
        components: z.array(Named).nullish(),
        issuetype: Named.nullish(),
        created: z.string().nullish(),
      })
      .passthrough(),
    renderedFields: z.object({ description: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export type JiraIssue = z.infer<typeof JiraIssueSchema>;

/** Cloud's `/rest/api/3/search/jql`: pages chained by `nextPageToken`. */
const CloudPage = z.object({ issues: z.array(JiraIssueSchema), nextPageToken: z.string().nullish(), isLast: z.boolean().optional() }).passthrough();
/** Data Center's `/rest/api/2/search`: pages by `startAt` out of `total`. */
const DataCenterPage = z.object({ issues: z.array(JiraIssueSchema), startAt: z.number(), total: z.number() }).passthrough();

export type SearchAnswer =
  | { ok: true; issues: JiraIssue[] }
  | { ok: false; kind: "command"; failure: JiraFailure; error: string }
  | { ok: false; kind: "schema"; error: string; raw: string };

/**
 * Every ticket a JQL query matches, page by page (issue #139): Cloud's enhanced search with its
 * `nextPageToken`, Data Center's `startAt`. Stops at the first failed page; a 429 says so.
 */
export async function searchJql(client: JiraClient, jql: string, fields = SEARCH_FIELDS): Promise<SearchAnswer> {
  const issues: JiraIssue[] = [];
  const cloud = client.apiVersion === "3";
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string> = { jql, fields, maxResults: String(PAGE_SIZE) };
    if (fields === SEARCH_FIELDS) query.expand = "renderedFields";
    if (cloud && token) query.nextPageToken = token;
    if (!cloud) query.startAt = String(issues.length);
    const r = await client.call("GET", cloud ? "/rest/api/3/search/jql" : "/rest/api/2/search", { query });
    if (!r.ok) {
      const wait = r.retryAfterSeconds !== undefined ? ` (retry after ${r.retryAfterSeconds}s)` : "";
      return { ok: false, kind: "command", failure: r.failure, error: r.failure === "rate_limited" ? `rate limited${wait}` : r.error };
    }
    if (cloud) {
      const parsed = CloudPage.safeParse(r.body);
      if (!parsed.success) return schemaError(parsed.error, r.body);
      issues.push(...parsed.data.issues);
      token = parsed.data.nextPageToken ?? undefined;
      if (parsed.data.isLast !== false || !token || parsed.data.issues.length === 0) break;
    } else {
      const parsed = DataCenterPage.safeParse(r.body);
      if (!parsed.success) return schemaError(parsed.error, r.body);
      issues.push(...parsed.data.issues);
      if (parsed.data.issues.length === 0 || issues.length >= parsed.data.total) break;
    }
  }
  return { ok: true, issues };
}

function schemaError(error: z.ZodError, body: unknown): SearchAnswer {
  return { ok: false, kind: "schema", error: `unexpected Jira answer: ${error.issues[0]?.path.join(".")} ${error.issues[0]?.message}`, raw: JSON.stringify(body) ?? "" };
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
// What has no place in a ticket's text; the board renders the rest through its own sanitiser.
turndown.remove(["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "noscript", "template"]);

/** A ticket's rendered description as Markdown: the HTML Jira renders, with anything active dropped. */
export function descriptionMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  return turndown.turndown(html).trim();
}

/** A Jira issue as a ticket of connection `connection` going to `origins` (issue #139). */
export function toTicket(issue: JiraIssue, connection: string, baseUrl: string, origins: readonly string[]): FetchedIssue {
  const { project, number } = splitTicketKey(issue.key);
  const f = issue.fields;
  const labels = [...(f.labels ?? []), ...(f.components ?? []).map((c) => c.name), ...(f.issuetype ? [f.issuetype.name] : [])];
  const created = f.created ? new Date(f.created) : undefined;
  return {
    repository: project,
    number,
    externalId: ticketExternalId(connection, issue.key),
    source: "jira-issue",
    url: `${baseUrl}/browse/${issue.key}`,
    title: f.summary ?? issue.key,
    body: descriptionMarkdown(issue.renderedFields?.description),
    labels: [...new Set(labels)],
    createdAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : new Date(0).toISOString(),
    priorityTier: jiraPriorityTier(f.priority?.name),
    origins: [...origins],
  };
}

/** Done in Jira's own sense: its status is in the `done` category, whatever the workflow calls it. */
export const isDone = (issue: JiraIssue): boolean => issue.fields.status?.statusCategory?.key === "done";
