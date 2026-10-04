import type { Ctx } from "../ids.js";
import type { Event } from "../event/types.js";
import { issuePriority } from "./priority.js";
import type { ItemSource, WorkItem } from "./types.js";

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
  /** `github-pr` for a pull request assigned to the user or asking for their review (D40, D47). */
  source?: ItemSource;
  /** Login of whoever opened the pull request (D47). */
  author?: string;
  /** The option of GitHub's "Priority" issue field (D45), when the issue has one set. */
  priorityField?: string;
  /**
   * The issue fields could not be read this time: a known item keeps its priority rather than
   * falling back to the labels and back again on the next poll.
   */
  priorityUnread?: boolean;
}

export interface Collected {
  item: WorkItem;
  events: Event[];
}

export const DEFAULT_PLAYBOOK = "implement";
/** The playbook a pull request that asks for the user's review starts with (D40). */
export const REVIEW_PLAYBOOK = "review";

export function defaultPlaybookFor(source: ItemSource): string {
  return source === "github-pr" ? REVIEW_PLAYBOOK : DEFAULT_PLAYBOOK;
}

/** `owner/repo#123` */
export function externalIdOf(issue: Pick<SourceIssue, "repository" | "number">): string {
  return `${issue.repository}#${issue.number}`;
}

/** A newly seen issue (or pull request) becomes a `ready` item plus its `item.collected` event. */
export function collect(
  issue: SourceIssue,
  ctx: Ctx,
  opts: { repoId?: string; playbook?: string } = {},
): Collected {
  const at = ctx.now();
  const source = issue.source ?? "github-issue";
  const item: WorkItem = {
    id: ctx.newId(),
    source,
    externalId: externalIdOf(issue),
    externalUrl: issue.url,
    title: issue.title,
    body: issue.body,
    labels: [...issue.labels],
    state: "ready",
    playbook: opts.playbook ?? defaultPlaybookFor(source),
    priority: issuePriority(issue),
    issueCreatedAt: issue.createdAt,
    stateSince: at,
    createdAt: at,
    updatedAt: at,
  };
  if (opts.repoId !== undefined) item.repoId = opts.repoId;
  if (issue.author !== undefined) item.author = issue.author;
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

/** A field that changed on GitHub, as `item.refreshed` records it. */
export interface Change<T> {
  from: T;
  to: T;
}

/** Payload of `item.refreshed`: only the fields that changed, never the body (D45). */
export interface RefreshedChanges {
  priority?: Change<number>;
  title?: Change<string>;
  labels?: Change<string[]>;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

/**
 * Apply the latest upstream content to a known item. Returns undefined when nothing changed.
 * An issue seen open again clears `closedUpstream`. The priority follows the "Priority" issue field,
 * else the labels (D45); when the fields could not be read it stays. State is never touched.
 *
 * A changed priority, title or label set is recorded as one `item.refreshed` event (actor `system`)
 * naming only what changed. Body, URL, author and label order change silently: they are noise in a timeline.
 */
export function refresh(item: WorkItem, issue: SourceIssue, ctx: Ctx): Collected | undefined {
  const priority = issue.priorityUnread ? item.priority : issuePriority(issue);
  const sameLabels =
    item.labels.length === issue.labels.length && item.labels.every((l, i) => l === issue.labels[i]);
  const changed =
    item.title !== issue.title ||
    item.body !== issue.body ||
    item.externalUrl !== issue.url ||
    !sameLabels ||
    item.priority !== priority ||
    item.issueCreatedAt !== issue.createdAt ||
    (issue.author !== undefined && item.author !== issue.author) ||
    item.closedUpstream === true;
  if (!changed) return undefined;
  const at = ctx.now();
  const next: WorkItem = {
    ...item,
    title: issue.title,
    body: issue.body,
    externalUrl: issue.url,
    labels: [...issue.labels],
    priority,
    issueCreatedAt: issue.createdAt,
    updatedAt: at,
  };
  if (issue.author !== undefined) next.author = issue.author;
  delete next.closedUpstream;

  const changes: RefreshedChanges = {};
  if (item.priority !== priority) changes.priority = { from: item.priority, to: priority };
  if (item.title !== issue.title) changes.title = { from: item.title, to: issue.title };
  if (!sameSet(item.labels, issue.labels)) changes.labels = { from: [...item.labels], to: [...issue.labels] };
  const events: Event[] = Object.keys(changes).length
    ? [{ id: ctx.newId(), itemId: item.id, at, actor: "system", type: "item.refreshed", payload: { changed: changes } }]
    : [];
  return { item: next, events };
}

/**
 * The issue is closed upstream. Done items on the board need no badge; already flagged items stay as
 * they are. An archived item is flagged, so a reopened issue is known as such (D37).
 */
export function markClosedUpstream(item: WorkItem, ctx: Ctx): WorkItem | undefined {
  if ((item.state === "done" && item.archivedAt === undefined) || item.closedUpstream) return undefined;
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
