import { linkRepo, repoChosen, type WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { JiraConnectionConfig } from "../config/connections.js";
import type { TicketSourceConfig } from "../config/ticket-sources.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { gitHubCliConnection } from "../gh/adapter.js";
import { collectIssues } from "../gh/collect-issues.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { providerRegistry } from "../providers/registry.js";
import { RepoStore } from "../repos/store.js";
import { StatusStore } from "../status/status.js";
import { testCtx } from "../test-support/ctx.js";
import { fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fakeHttp, json, type FakeRequest } from "../test-support/fake-http.js";
import type { HttpResponse } from "../providers/http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { jiraConnection } from "./connection.js";

const APP = "github.com/acme/app";
const API = "github.com/acme/api";
const cloud: JiraConnectionConfig = { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" };

const gh = fakeExec({
  "which gh": ok("/opt/homebrew/bin/gh\n"),
  "gh auth status": ok(fixture("gh/auth-status-ok.stdout")),
  "gh search issues": ok(fixture("gh/search-issues-empty.json")),
  "gh search prs": ok(fixture("gh/search-prs-empty.json")),
});

const jql = (r: FakeRequest) => new URL(`https://x${r.path}`).searchParams;

function setup(entries: TicketSourceConfig[]) {
  let search: (r: FakeRequest) => HttpResponse = (r) =>
    json(fixture(jql(r).get("nextPageToken") ? "jira/cloud-search-page2.json" : "jira/cloud-search-page1.json"));
  const http = fakeHttp({ "GET /rest/api/3/search/jql": (r) => search(r) });
  const db = openDb(":memory:");
  const repos = new RepoStore(db);
  repos.upsert({ id: "r-api", path: "/src/api", originUrl: API, defaultBranch: "main" }, "2026-10-01T00:00:00.000Z");
  const pushed: WorkItem[] = [];
  const deps = {
    db, exec: gh, log: silentLog, ctx: testCtx(), repos,
    providers: providerRegistry([gitHubCliConnection(gh, "github.com", "github"), jiraConnection(cloud, http, memoryTokens({ jira: "t" }), () => entries)]),
    sources: () => ({}),
    items: new ItemStore(db), events: new EventStore(db), status: new StatusStore("0.0.0", "2026-09-01T00:00:00.000Z"),
    onItemUpdated: (i: WorkItem) => pushed.push(i),
  };
  return { deps, http, pushed, answer: (f: (r: FakeRequest) => HttpResponse) => (search = f) };
}

describe("Jira tickets on the board (issue #139)", () => {
  it("collects tickets of several repositories, waiting for the user's choice", async () => {
    const { deps } = setup([{ connection: "jira", repos: [APP, API] }]);
    await collectIssues(deps);
    const stored = deps.items.all();
    expect(stored.map((s) => [s.item.externalId, s.originUrl, s.item.repoCandidates, s.item.repoOrigin, s.item.repoId])).toEqual([
      ["jira:APP-123", "", [APP, API], undefined, undefined],
      ["jira:APP-140", "", [APP, API], undefined, undefined],
    ]);
    expect(stored[0]!.item).toMatchObject({ source: "jira-issue", priority: 1, externalUrl: "https://acme.atlassian.net/browse/APP-123" });
    expect(deps.status.get().lastPoll).toMatchObject({ ok: true, issues: 2 });

    // The user picks the API repository: the item is linked to its clone and keeps it on the next poll.
    const item = stored[0]!.item;
    const chosen = repoChosen(item, deps.ctx, API);
    deps.items.update(linkRepo(chosen.item, deps.repos.byOrigin(API)?.id, deps.ctx) ?? chosen.item);
    await collectIssues(deps);
    const after = deps.items.get(item.id)!;
    expect([after.originUrl, after.item.repoOrigin, after.item.repoId]).toEqual([API, API, "r-api"]);
  });

  it("links a ticket of one repository straight away", async () => {
    const { deps } = setup([{ connection: "jira", repos: [API] }]);
    await collectIssues(deps);
    expect(deps.items.all().map((s) => [s.originUrl, s.item.repoOrigin, s.item.repoId])).toEqual([
      [API, API, "r-api"],
      [API, API, "r-api"],
    ]);
  });

  it("asks for the tickets the search no longer finds in one batch, and closes the done ones", async () => {
    const { deps, http, answer } = setup([{ connection: "jira", repos: [APP] }]);
    await collectIssues(deps);
    answer((r) => {
      if (jql(r).get("jql")!.startsWith("key in")) return json(fixture("jira/cloud-states.json"));
      return json({ issues: [], isLast: true });
    });
    http.requests.length = 0;
    await collectIssues(deps);
    expect(http.requests.map((r) => jql(r).get("jql"))).toEqual(["assignee = currentUser() AND statusCategory != Done", "key in (APP-123,APP-140)"]);
    expect(deps.items.all().map((s) => [s.item.externalId, s.item.state, s.item.closedUpstream ?? false])).toEqual([
      ["jira:APP-123", "done", true],
      ["jira:APP-140", "ready", false],
    ]);
  });

  it("skips Jira for the poll on a 429 and closes nothing", async () => {
    const { deps, http, answer } = setup([{ connection: "jira", repos: [APP] }]);
    await collectIssues(deps);
    answer(() => ({ status: 429, headers: { "retry-after": "30" }, body: "" }));
    http.requests.length = 0;
    await collectIssues(deps);
    expect(http.requests).toHaveLength(1);
    expect(deps.items.all().map((s) => s.item.state)).toEqual(["ready", "ready"]);
    expect(deps.status.get().lastPoll).toMatchObject({ ok: false, error: 'Jira "assignee = currentUser() AND statusCategory != Done" on acme.atlassian.net: rate limited (retry after 30s)' });
  });
});
