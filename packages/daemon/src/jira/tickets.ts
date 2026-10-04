import { parseTicketId } from "@donepm/core";
import { queryOf, type TicketSourceConfig } from "../config/ticket-sources.js";
import type { FetchedIssue, FetchResult, Search, TicketRef, TicketSource, TicketState } from "../providers/ticket-source.js";
import type { JiraClient } from "./client.js";
import { jiraComment, jiraTransition, jiraTransitions } from "./write.js";
import { isDone, searchJql, toTicket, type JiraIssue, type SearchAnswer } from "./search.js";

/** `key in (…)` takes this many keys at a time. */
const KEYS_PER_SEARCH = 100;

/**
 * Jira as a ticket source (issue #139): one search per `ticketSources` entry of this connection,
 * each ticket going to the union of the repositories of the entries that found it. A 429 ends the
 * connection's poll there; the next poll tries again.
 */
export function jiraTickets(client: JiraClient, entries: () => readonly TicketSourceConfig[]): TicketSource {
  const { id, baseUrl } = client.config;
  const tickets = (issues: readonly JiraIssue[], origins: (key: string) => readonly string[]) =>
    issues.filter((i) => !isDone(i)).map((i) => toTicket(i, id, baseUrl, origins(i.key)));

  const statusOf = async (refs: readonly TicketRef[]): Promise<Map<string, TicketState>> => {
    const out = new Map<string, TicketState>();
    const keys = refs.flatMap((r) => {
      const t = parseTicketId(r.externalId);
      return t && t.connection === id ? [t.key] : [];
    });
    for (let i = 0; i < keys.length; i += KEYS_PER_SEARCH) {
      const chunk = keys.slice(i, i + KEYS_PER_SEARCH);
      const r = await searchJql(client, `key in (${chunk.join(",")})`, "status");
      if (r.ok) {
        for (const issue of r.issues) out.set(`${id}:${issue.key}`, isDone(issue) ? "CLOSED" : "OPEN");
        continue;
      }
      // Jira refuses the whole query for one key it does not know (deleted, moved or out of sight):
      // ask each on its own, and leave the unknown ones undecided.
      if (r.kind !== "command" || r.failure !== "error") break;
      for (const key of chunk) {
        const one = await client.call("GET", `/rest/api/${client.apiVersion}/issue/${encodeURIComponent(key)}`, { query: { fields: "status" } });
        if (one.ok) out.set(`${id}:${key}`, isDone(one.body as JiraIssue) ? "CLOSED" : "OPEN");
        else if (one.failure === "rate_limited") return out;
      }
    }
    return out;
  };

  /** The ticket's key, when the ref is one of this connection's. */
  const keyOf = (ticket: TicketRef): string | undefined => {
    const t = parseTicketId(ticket.externalId);
    return t && t.connection === id ? t.key : undefined;
  };
  const notOurs = (ticket: TicketRef) => ({ ok: false as const, error: `${ticket.externalId} is not a ticket of ${id}` });

  return {
    async collect() {
      const mine = entries().filter((e) => e.connection === id);
      const answers: Array<{ entry: TicketSourceConfig; answer: SearchAnswer }> = [];
      for (const entry of mine) {
        const answer = await searchJql(client, queryOf(entry));
        answers.push({ entry, answer });
        if (!answer.ok && answer.kind === "command" && answer.failure === "rate_limited") break;
      }
      const origins = new Map<string, Set<string>>();
      for (const { entry, answer } of answers) {
        if (!answer.ok) continue;
        for (const issue of answer.issues) {
          const set = origins.get(issue.key) ?? new Set<string>();
          for (const repo of entry.repos) set.add(repo);
          origins.set(issue.key, set);
        }
      }
      return answers.map(({ entry, answer }): Search => ({
        label: `Jira ${short(queryOf(entry))}`,
        result: answer.ok ? { ok: true, issues: tickets(answer.issues, (key) => [...origins.get(key)!]) } : fetchFailure(answer),
      }));
    },
    async query(origin, jql) {
      const answer = await searchJql(client, jql);
      return answer.ok ? { ok: true, issues: tickets(answer.issues, () => (origin ? [origin] : [])) } : fetchFailure(answer);
    },
    async withFields(issues: readonly FetchedIssue[]) {
      return [...issues];
    },
    async state(ticket) {
      return (await statusOf([ticket])).get(ticket.externalId);
    },
    states: statusOf,
    async comment(ticket, markdown) {
      const key = keyOf(ticket);
      return key ? jiraComment(client, key, markdown) : notOurs(ticket);
    },
    async transitions(ticket) {
      const key = keyOf(ticket);
      return key ? jiraTransitions(client, key) : notOurs(ticket);
    },
    async transition(ticket, transitionId, comment) {
      const key = keyOf(ticket);
      return key ? jiraTransition(client, key, transitionId, comment) : notOurs(ticket);
    },
    async assignToMe(ticket) {
      const t = parseTicketId(ticket.externalId);
      if (!t || t.connection !== id) return notOurs(ticket);
      const me = await client.call("GET", `/rest/api/${client.apiVersion}/myself`);
      if (!me.ok) return { ok: false, error: me.error };
      const who = me.body as { accountId?: unknown; name?: unknown } | undefined;
      // Cloud names people by account id only; Data Center by user name.
      const body = client.apiVersion === "3" ? { accountId: who?.accountId } : { name: who?.name };
      if (typeof Object.values(body)[0] !== "string") return { ok: false, error: "Jira did not say who the token belongs to" };
      const r = await client.call("PUT", `/rest/api/${client.apiVersion}/issue/${encodeURIComponent(t.key)}/assignee`, { body });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
  };
}

function fetchFailure(answer: Exclude<SearchAnswer, { ok: true }>): FetchResult {
  return answer.kind === "schema" ? { ok: false, kind: "schema", error: answer.error, raw: answer.raw } : { ok: false, kind: "command", error: answer.error };
}

const short = (jql: string) => (jql.length > 64 ? `"${jql.slice(0, 63)}…"` : `"${jql}"`);
