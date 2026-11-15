import { z } from "zod";
import type { Done } from "../providers/result.js";
import type { CommentAnswer, TicketTransition, TransitionsAnswer } from "../providers/ticket-source.js";
import type { JiraClient } from "./client.js";
import { jiraBody } from "./markup.js";

/**
 * Comments and status changes on a ticket (issue #139). The daemon calls these only to execute a
 * draft the user approved, and to list the transitions a draft may use; never from the agent.
 */

const issuePath = (client: JiraClient, key: string, tail: string) => `/rest/api/${client.apiVersion}/issue/${encodeURIComponent(key)}/${tail}`;

const TransitionsSchema = z.object({
  transitions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      to: z.object({ name: z.string() }).passthrough(),
      fields: z.record(z.object({ required: z.boolean().optional(), hasDefaultValue: z.boolean().optional(), name: z.string().optional() }).passthrough()).optional(),
    }).passthrough(),
  ),
}).passthrough();

/** The transitions the ticket's workflow offers now, with the fields each one would need. */
export async function jiraTransitions(client: JiraClient, key: string): Promise<TransitionsAnswer> {
  const r = await client.call("GET", issuePath(client, key, "transitions"), { query: { expand: "transitions.fields" } });
  if (!r.ok) return { ok: false, error: r.error };
  const parsed = TransitionsSchema.safeParse(r.body);
  if (!parsed.success) return { ok: false, error: "Jira answered the transitions in an unexpected shape" };
  return {
    ok: true,
    transitions: parsed.data.transitions.map((t): TicketTransition => ({
      id: t.id,
      name: t.name,
      toStatus: t.to.name,
      // A comment is never something the user has to fill; donePM adds its own when asked.
      requiredFields: Object.entries(t.fields ?? {})
        .filter(([field, f]) => field !== "comment" && f.required === true && f.hasDefaultValue !== true)
        .map(([field, f]) => f.name ?? field),
    })),
  };
}

export async function jiraComment(client: JiraClient, key: string, markdown: string): Promise<CommentAnswer> {
  const r = await client.call("POST", issuePath(client, key, "comment"), { body: { body: jiraBody(markdown, client.apiVersion) } });
  if (!r.ok) return { ok: false, error: r.error };
  const id = (r.body as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") return { ok: false, error: "Jira did not answer with the comment's id" };
  const base = client.config.baseUrl.replace(/\/+$/, "");
  return { ok: true, id, url: `${base}/browse/${key}?focusedCommentId=${encodeURIComponent(id)}` };
}

/** One call: the move and its comment land together or not at all. */
export async function jiraTransition(client: JiraClient, key: string, transitionId: string, comment?: string): Promise<Done> {
  const body = {
    transition: { id: transitionId },
    ...(comment ? { update: { comment: [{ add: { body: jiraBody(comment, client.apiVersion) } }] } } : {}),
  };
  const r = await client.call("POST", issuePath(client, key, "transitions"), { body });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
