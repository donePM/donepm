import type { PriorityTier } from "../item/priority.js";
import { DEFAULT_PRIORITY_TIER } from "../item/priority.js";

/** A Jira issue's key as Jira spells it: project key, dash, number (`APP-123`). */
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** A ticket id with its connection: `jira:APP-123` (issue #139). */
const TICKET_ID = /^([a-z0-9][a-z0-9-]*):([A-Za-z][A-Za-z0-9_]*-\d+)$/;

export interface TicketId {
  /** The connection the ticket comes from (`jira`). */
  connection: string;
  /** `APP-123` */
  key: string;
}

export function isTicketKey(key: string): boolean {
  return KEY.test(key);
}

/** `jira:APP-123`: the connection's id in front, so no GitHub id (`owner/repo#1`) can ever mean the same. */
export function ticketExternalId(connection: string, key: string): string {
  return `${connection}:${key}`;
}

/** The connection and key of a prefixed ticket id; undefined for a GitHub id or anything else. */
export function parseTicketId(externalId: string): TicketId | undefined {
  const m = TICKET_ID.exec(externalId);
  return m ? { connection: m[1]!, key: m[2]! } : undefined;
}

/** `APP` and 123 from `APP-123`. */
export function splitTicketKey(key: string): { project: string; number: number } {
  const at = key.lastIndexOf("-");
  return { project: key.slice(0, at), number: Number(key.slice(at + 1)) };
}

const JIRA_PRIORITIES: Record<string, PriorityTier> = {
  highest: 0,
  blocker: 0,
  high: 1,
  critical: 1,
  medium: 2,
  major: 2,
  low: 3,
  lowest: 3,
  minor: 3,
  trivial: 3,
};

/**
 * The tier of a Jira priority, by its name: Cloud's Highest..Lowest and Data Center's
 * Blocker..Trivial. A priority a site made up of its own, or none, is a 2.
 */
export function jiraPriorityTier(name: string | undefined): PriorityTier {
  return (name === undefined ? undefined : JIRA_PRIORITIES[name.trim().toLowerCase()]) ?? DEFAULT_PRIORITY_TIER;
}

/**
 * What a branch and a PR title name the work by: `APP-123` for a ticket, the number for a GitHub
 * issue (`owner/repo#12` → `12`). Undefined when the id names neither.
 */
export function workRef(externalId: string): string | undefined {
  const ticket = parseTicketId(externalId);
  if (ticket) return ticket.key;
  return /#(\d+)$/.exec(externalId)?.[1];
}

/**
 * A pull request title for a ticket starts with its key, which is how Jira links the two:
 * `APP-123 Fix the login`. A title that already starts with it stays as it is; a GitHub issue's
 * title is never touched.
 */
export function prTitleFor(externalId: string, title: string): string {
  const ticket = parseTicketId(externalId);
  if (!ticket) return title;
  const trimmed = title.trim();
  if (new RegExp(`^\\[?${ticket.key}\\b`, "i").test(trimmed)) return trimmed;
  return `${ticket.key} ${trimmed}`;
}
