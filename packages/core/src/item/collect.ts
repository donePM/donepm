import type { Ctx } from "../ids.js";
import type { Event } from "../event/types.js";
import { priorityTier } from "./priority.js";
import type { WorkItem } from "./types.js";

/** An issue as a source reports it, already validated. */
export interface SourceIssue {
  /** `owner/repo` */
  repository: string;
  number: number;
  url: string;
  title: string;
  body: string;
  labels: string[];
  /** When the issue was opened, ISO 8601. */
  createdAt: string;
}

export interface Collected {
  item: WorkItem;
  events: Event[];
}

export const DEFAULT_PLAYBOOK = "implement";

/** `owner/repo#123` */
export function externalIdOf(issue: Pick<SourceIssue, "repository" | "number">): string {
  return `${issue.repository}#${issue.number}`;
}

/** A newly seen issue becomes a `ready` item plus its `item.collected` event. */
export function collect(
  issue: SourceIssue,
  ctx: Ctx,
  opts: { repoId?: string; playbook?: string } = {},
): Collected {
  const at = ctx.now();
  const item: WorkItem = {
    id: ctx.newId(),
    source: "github-issue",
    externalId: externalIdOf(issue),
    externalUrl: issue.url,
    title: issue.title,
    body: issue.body,
    labels: [...issue.labels],
    state: "ready",
    playbook: opts.playbook ?? DEFAULT_PLAYBOOK,
    priority: priorityTier(issue.labels),
    issueCreatedAt: issue.createdAt,
    stateSince: at,
    createdAt: at,
    updatedAt: at,
  };
  if (opts.repoId !== undefined) item.repoId = opts.repoId;
  const event: Event = {
    id: ctx.newId(),
    itemId: item.id,
    at,
    actor: "system",
    type: "item.collected",
    payload: { externalId: item.externalId, url: item.externalUrl },
  };
  return { item, events: [event] };
}

/**
 * Apply the latest upstream content to a known item. Returns undefined when nothing changed.
 * An issue seen open again clears `closedUpstream`. The priority follows the labels. State is never
 * touched.
 */
export function refresh(item: WorkItem, issue: SourceIssue, ctx: Ctx): WorkItem | undefined {
  const sameLabels =
    item.labels.length === issue.labels.length && item.labels.every((l, i) => l === issue.labels[i]);
  const changed =
    item.title !== issue.title ||
    item.body !== issue.body ||
    item.externalUrl !== issue.url ||
    !sameLabels ||
    item.priority !== priorityTier(issue.labels) ||
    item.issueCreatedAt !== issue.createdAt ||
    item.closedUpstream === true;
  if (!changed) return undefined;
  const next: WorkItem = {
    ...item,
    title: issue.title,
    body: issue.body,
    externalUrl: issue.url,
    labels: [...issue.labels],
    priority: priorityTier(issue.labels),
    issueCreatedAt: issue.createdAt,
    updatedAt: ctx.now(),
  };
  delete next.closedUpstream;
  return next;
}

/** The issue is closed upstream. Done items need no badge; already flagged items stay as they are. */
export function markClosedUpstream(item: WorkItem, ctx: Ctx): WorkItem | undefined {
  if (item.state === "done" || item.closedUpstream) return undefined;
  return { ...item, closedUpstream: true, updatedAt: ctx.now() };
}

/** Link or unlink the local clone after a repo scan. Returns undefined when nothing changed. */
export function linkRepo(item: WorkItem, repoId: string | undefined, ctx: Ctx): WorkItem | undefined {
  if (item.repoId === repoId) return undefined;
  const next: WorkItem = { ...item, updatedAt: ctx.now() };
  if (repoId === undefined) delete next.repoId;
  else next.repoId = repoId;
  return next;
}
