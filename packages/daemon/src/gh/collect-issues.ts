import { externalIdOf, GITHUB_COM, initialPlaybook, parseTicketId, type Ctx, type ItemSource, type SourceIssue, type WorkItem } from "@donepm/core";
import type { Config } from "../config/config.js";
import type { Db } from "../db/database.js";
import type { EventStore } from "../events/store.js";
import { refreshPrStatuses } from "../items/pr-status.js";
import { applyClosedUpstream, issueOrigin, syncIssues } from "../items/sync.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import { managedOrigins } from "../repos/managed.js";
import type { RepoStore } from "../repos/store.js";
import { TombstoneStore } from "../retention/tombstones.js";
import type { SourcePollStatus, StatusStore } from "../status/status.js";
import { hostOf, serves, ticketConnectionOf, type Connection, type Providers } from "../providers/registry.js";
import type { FetchedIssue, FetchResult, Search, TicketRef, TicketSource, TicketState } from "../providers/ticket-source.js";
import { detectHost, ghStatusOf } from "./host-status.js";
import { githubHosts } from "./hosts.js";

export interface CollectDeps {
  db: Db;
  exec: Exec;
  providers: Providers;
  items: ItemStore;
  events: EventStore;
  repos: RepoStore;
  status: StatusStore;
  ctx: Ctx;
  log: Log;
  /** Managed flags (D46) and per-repository queries (issue #32); repos without a query only get the default search. */
  sources: () => Config["sources"];
  onItemUpdated: (item: WorkItem) => void;
  /** The playbooks a repository offers an ingest (issue #153); a new item starts with one of them. */
  allowedPlaybooks?: (origin: string, source: ItemSource) => readonly string[];
}

const RAW_LOG_LIMIT = 10_000;

/**
 * Where a connection's tickets live: its host, the organization on a host many share
 * (`dev.azure.com/acme`, issue #142), or its id for one without a host.
 */
const placeOf = (connection: Connection) =>
  connection.organization !== undefined && connection.host ? `${connection.host}/${connection.organization}` : connection.host ?? connection.id;

/**
 * One poll cycle (spec 6.2): the default search (assigned to me), the pull requests that ask for
 * the user's review (issue #48, D40) or are assigned to them (issue #98, D47), and one query per repository that has its own (issue #32),
 * merged by `externalId`. A failing source does not stop the others.
 * Only managed repositories (D46) are polled with their own query, and only their issues are kept
 * from the searches; the others found there are counted for Settings' discovered list.
 * Every GitHub host donePM works with is searched on its own (issue #140); a host whose `gh` is
 * logged out or fails is skipped and reported, and the others go on.
 * A Jira or Azure Boards connection searches each of its `ticketSources` (issues #139, #142); its
 * tickets go to the repositories named there, so they bypass the managed filter, and a Jira 429
 * skips it for this poll.
 * Never throws: failures are logged and recorded in the status, so Settings can show them.
 */
export async function collectIssues(deps: CollectDeps): Promise<void> {
  const { exec, providers, repos, status, ctx, log } = deps;
  const at = ctx.now();
  try {
    // `gh` is logged in to each GitHub host on its own; a host it is not ready for is skipped.
    const hosts = githubHosts(providers);
    const stateOf = (host: string) => ghStatusOf(status.get(), host)?.state;
    for (const host of hosts) if (stateOf(host) !== "ready") await detectHost(exec, status, host);
    const isReady = (place: string) => !hosts.includes(place) || stateOf(place) === "ready";

    const sourceConfig = deps.sources();
    const managed = managedOrigins(sourceConfig);
    // The searches are one call each per host however many repositories there are, and they find
    // the repositories to offer; an unmanaged repository costs no call of its own.
    const known = () => repos.all().map((r) => r.originUrl).filter((origin) => managed.has(origin));
    const collected: Array<{ place: string; searches: Search[] }> = [];
    for (const { connection, source } of providers.ticketSources()) {
      const place = placeOf(connection);
      if (isReady(place)) collected.push({ place, searches: await source.collect(known) });
    }
    // A connection with no search of its own (an Azure DevOps one without ticket sources) is no place to poll.
    const places = [...new Set([...hosts, ...collected.filter((c) => c.searches.length > 0).map((c) => c.place)])];
    // github.com alone reads as before; with more hosts each label and error names its host.
    const named = (place: string, what?: string) =>
      places.length === 1 && place === GITHUB_COM ? what : what ? `${what} on ${place}` : place;
    const notReady = hosts.filter((host) => !isReady(host)).map((host) => [host, named(host, `gh ${stateOf(host)}`)!] as const);
    if (!places.some(isReady)) {
      status.update({ lastPoll: { at, ok: false, error: notReady.map(([, error]) => error).join("; ") || "no ticket source" } });
      return;
    }

    /** The place of a ticket id's connection (issue #139); undefined for a GitHub id. */
    const ticketPlace = (externalId: string): string | undefined => {
      const id = parseTicketId(externalId)?.connection;
      const c = id === undefined ? undefined : providers.connections.find((x) => x.id === id && x.ticketSource);
      return c && placeOf(c);
    };
    /** The place of a repository: that of the connection whose tickets it has, else its host. */
    const originPlace = (origin: string): string => {
      const c = providers.connections.find((x) => x.ticketSource && serves(x, origin));
      return c ? placeOf(c) : hostOf(origin);
    };
    const fetched: Array<{ place: string; origin?: string; label?: string; result: FetchResult }> = [];
    const mainOf = new Map<string, FetchResult>();
    for (const { place, searches } of collected) {
      if (searches[0]) mainOf.set(place, searches[0].result);
      for (const { label, result } of searches) {
        const text = named(place, label);
        fetched.push({ place, ...(text ? { label: text } : {}), result });
      }
    }
    for (const [origin, source] of Object.entries(sourceConfig)) {
      const tickets = providers.ticketSource(origin);
      const place = originPlace(origin);
      if (source.query && managed.has(origin) && tickets && isReady(place)) fetched.push({ place, origin, result: await tickets.query(origin, source.query) });
    }

    const issues: FetchedIssue[] = [];
    const errors: string[] = notReady.map(([, error]) => error);
    // Hosts not every source answered for: their items may just not have been asked.
    const unanswered = new Set<string>(notReady.map(([host]) => host));
    let failedSources = 0;
    const sources: Record<string, SourcePollStatus> = {};
    const discovered = new Map<string, Set<number>>();
    for (const { place, origin, label, result } of fetched) {
      if (result.ok) {
        for (const issue of result.issues) {
          // A ticket goes where its ticket sources send it, not where its URL points.
          if (issue.origins) {
            issues.push(issue);
            continue;
          }
          const from = issueOrigin(issue);
          if (managed.has(from)) issues.push(issue);
          else if (!repos.byOrigin(from)) discovered.set(from, (discovered.get(from) ?? new Set()).add(issue.number));
        }
        if (origin) sources[origin] = { ok: true, issues: result.issues.length };
        continue;
      }
      if (result.kind === "schema") {
        log.error({ origin, label, error: result.error, raw: result.raw.slice(0, RAW_LOG_LIMIT) }, "gh output failed schema validation");
      } else {
        log.warn({ origin, label, error: result.error }, "gh poll failed");
      }
      const where = origin ?? label;
      errors.push(where ? `${where}: ${result.error}` : result.error);
      if (origin) sources[origin] = { ok: false, error: result.error };
      unanswered.add(place);
      failedSources++;
    }
    // The default search failing on the command maybe means logged out; detect again next cycle.
    for (const [place, main] of mainOf) if (hosts.includes(place) && !main.ok && main.kind === "command") await detectHost(exec, status, place);

    // GitHub's "Priority" issue field, one batched call per host for all issues of the poll (D45).
    const synced = syncIssues(
      await withFields(providers, issues),
      {
        ...deps,
        playbookFor: (origin, source) => initialPlaybook(source, sourceConfig[origin]?.playbook, deps.allowedPlaybooks?.(origin, source) ?? []),
      },
      (origin, externalId) => (ticketPlace(externalId) ? true : managed.has(origin)),
    );
    for (const item of [...synced.collected, ...synced.updated]) deps.onItemUpdated(item);

    // An item is only "missing" if every source of its place answered; otherwise it may just not
    // have been asked. A ticket's place is its connection's, whatever repository it went to.
    const searched = new Set(fetched.map((f) => f.place));
    const answered = (ref: TicketRef) => {
      const place = ticketPlace(ref.externalId) ?? (ref.origin ? originPlace(ref.origin) : undefined);
      return !!place && isReady(place) && searched.has(place) && !unanswered.has(place);
    };
    const missing = synced.missing.map((item) => {
      const origin = deps.items.get(item.id)?.originUrl ?? "";
      return { item, ref: { externalId: item.externalId, origin } };
    });
    const asks: TicketRef[] = [
      ...missing.map((m) => m.ref).filter(answered),
      ...synced.openTombstones.map((t) => ({ externalId: t.externalId, origin: t.originUrl })).filter(answered),
    ];
    const states = await statesOf(providers, asks);
    for (const { item, ref } of missing) {
      if (states.get(ref.externalId) !== "CLOSED" || !answered(ref)) continue;
      const flagged = applyClosedUpstream(item.id, deps);
      if (flagged) deps.onItemUpdated(flagged);
    }
    // A purged issue seen closed is imported fresh if it ever shows up again (D37).
    const tombstones = new TombstoneStore(deps.db);
    for (const t of synced.openTombstones) if (states.get(t.externalId) === "CLOSED") tombstones.markClosed(t.externalId);

    // Where the pull requests of others stand: conflicts, reviews, checks (D47). Not a source: a
    // failed read leaves the last status in place.
    await refreshPrStatuses(deps, (origin) => managed.has(origin) && isReady(hostOf(origin)));

    const count = new Set(issues.map(externalIdOf)).size;
    log.info({ issues: count, collected: synced.collected.length, updated: synced.updated.length, failed: errors.length }, "poll done");
    status.update({
      lastPoll: {
        at,
        ok: errors.length === 0,
        ...(failedSources < fetched.length ? { issues: count } : {}),
        ...(errors.length ? { error: errors.join("; ") } : {}),
        ...(Object.keys(sources).length ? { sources } : {}),
        ...(discovered.size ? { discovered: Object.fromEntries([...discovered].map(([origin, numbers]) => [origin, numbers.size])) } : {}),
      },
    });
  } catch (e) {
    log.error({ err: e }, "poll crashed");
    status.update({ lastPoll: { at, ok: false, error: (e as Error).message } });
  }
}

/** The fields read in a batch (D45), one batch per ticket source; a ticket no source serves keeps what it has. */
async function withFields(providers: Providers, issues: readonly FetchedIssue[]): Promise<SourceIssue[]> {
  const bySource = new Map<TicketSource | undefined, FetchedIssue[]>();
  for (const issue of issues) {
    const source = providers.ticketSource(issue.url);
    bySource.set(source, [...(bySource.get(source) ?? []), issue]);
  }
  const out: SourceIssue[] = [];
  for (const [source, group] of bySource) out.push(...(source ? await source.withFields(group) : group));
  return out;
}

/**
 * Whether each ticket is closed upstream, by `externalId`: in one batch per source that offers it
 * (Jira's `key in (…)`, issue #139), else one by one.
 */
async function statesOf(providers: Providers, refs: readonly TicketRef[]): Promise<Map<string, TicketState>> {
  const bySource = new Map<TicketSource, TicketRef[]>();
  for (const ref of refs) {
    const source = ticketConnectionOf(providers, ref)?.ticketSource;
    if (source) bySource.set(source, [...(bySource.get(source) ?? []), ref]);
  }
  const out = new Map<string, TicketState>();
  for (const [source, group] of bySource) {
    if (source.states) {
      for (const [id, state] of await source.states(group)) out.set(id, state);
      continue;
    }
    for (const ref of group) {
      const state = await source.state(ref);
      if (state) out.set(ref.externalId, state);
    }
  }
  return out;
}
