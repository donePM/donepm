import type { WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { TicketSourceConfig } from "../config/ticket-sources.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { gitHubCliConnection } from "../gh/adapter.js";
import { assignOnStart } from "../gh/assign-on-start.js";
import { collectIssues } from "../gh/collect-issues.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { providerRegistry } from "../providers/registry.js";
import { RepoStore } from "../repos/store.js";
import { StatusStore } from "../status/status.js";
import type { HttpClient, HttpRequest, HttpResponse } from "../providers/http.js";
import { boardsHttp, requestLines } from "../test-support/azure-boards.js";
import { json, type FakeRequest } from "../test-support/fake-http.js";
import { testCtx } from "../test-support/ctx.js";
import { fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureDevOpsConnection } from "./connection.js";

const API = "github.com/acme/api";

const gh = fakeExec({
  "which gh": ok("/opt/homebrew/bin/gh\n"),
  "gh auth status": ok(fixture("gh/auth-status-ok.stdout")),
  "gh search issues": ok(fixture("gh/search-issues-empty.json")),
  "gh search prs": ok(fixture("gh/search-prs-empty.json")),
});

function setup(entries: TicketSourceConfig[]) {
  const boards = boardsHttp();
  // A later poll may answer some requests differently; the rest go to the organization `acme`.
  let override: (r: FakeRequest) => HttpResponse | undefined = () => undefined;
  const http = Object.assign((async (request: HttpRequest) => {
    const u = new URL(request.url);
    const seen: FakeRequest = { method: request.method, path: u.pathname + u.search, body: request.body, headers: {}, host: u.host };
    const r = override(seen);
    if (!r) return boards(request);
    boards.requests.push(seen);
    return r;
  }) as HttpClient, { requests: boards.requests });
  const db = openDb(":memory:");
  const repos = new RepoStore(db);
  repos.upsert({ id: "r-api", path: "/src/api", originUrl: API, defaultBranch: "main" }, "2026-10-01T00:00:00.000Z");
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const ado = azureDevOpsConnection({ id: "ado", organization: "acme", backend: "api", exec: fakeExec({}), http, tokens: memoryTokens({ ado: "pat" }), ticketSources: () => entries });
  const deps = {
    db, exec: gh, log: silentLog, ctx: testCtx(), repos, items, events,
    providers: providerRegistry([gitHubCliConnection(gh, "github.com", "github"), ado]),
    sources: () => ({}),
    ticketSources: () => entries,
    status: new StatusStore("0.0.0", "2026-09-01T00:00:00.000Z"),
    onItemUpdated: (_: WorkItem) => {},
  };
  return { deps, http, answer: (f: typeof override) => (override = f) };
}

describe("Azure Boards work items on the board (issue #142)", () => {
  it("collects the open work items of the query for the entry's repository", async () => {
    const { deps } = setup([{ connection: "ado", project: "Platform", repos: [API] }]);
    await collectIssues(deps);
    const stored = deps.items.all();
    expect(stored.map((s) => [s.item.externalId, s.item.source, s.originUrl, s.item.repoId, s.item.priority])).toEqual([
      ["ado:1234", "ado-work-item", API, "r-api", 0],
      ["ado:1240", "ado-work-item", API, "r-api", 2],
    ]);
    expect(stored[0]!.item.externalUrl).toBe("https://dev.azure.com/acme/Platform/_workitems/edit/1234");
    expect(deps.status.get().lastPoll).toMatchObject({ ok: true, issues: 2 });
  });

  it("asks nothing of Azure DevOps and leaves the GitHub poll as it was without an entry", async () => {
    const { deps, http } = setup([]);
    await collectIssues(deps);
    expect(http.requests).toEqual([]);
    expect(deps.status.get().lastPoll).toMatchObject({ ok: true, issues: 0 });
  });

  it("asks for the work items the query no longer finds in one batch and closes the finished ones", async () => {
    const { deps, http, answer } = setup([{ connection: "ado", project: "Platform", repos: [API] }]);
    await collectIssues(deps);
    answer((r) => {
      if (r.path.includes("/wiql")) return json({ queryType: "flat", workItems: [] });
      if (r.path.includes("/workitemsbatch")) {
        return json({ count: 2, value: [
          { id: 1234, fields: { "System.TeamProject": "Platform", "System.WorkItemType": "Bug", "System.State": "Closed" } },
          { id: 1240, fields: { "System.TeamProject": "Platform", "System.WorkItemType": "User Story", "System.State": "Active" } },
        ] });
      }
      return undefined;
    });
    http.requests.length = 0;
    await collectIssues(deps);
    expect(requestLines(http.requests).filter((l) => l.endsWith("/workitemsbatch"))).toHaveLength(1);
    expect(http.requests.find((r) => r.path.includes("/workitemsbatch"))!.body).toMatchObject({ ids: [1234, 1240] });
    expect(deps.items.all().map((s) => [s.item.externalId, s.item.state, s.item.closedUpstream ?? false])).toEqual([
      ["ado:1234", "done", true],
      ["ado:1240", "ready", false],
    ]);
  });

  it("assigns a work item on start when its ticket source opted in, through the daemon's connection", async () => {
    const { deps, http } = setup([{ connection: "ado", project: "Platform", repos: [API], assignOnStart: true }]);
    await collectIssues(deps);
    const item = deps.items.all()[0]!.item;
    deps.items.update({ ...item, state: "running" });
    const writer = itemWriter({ db: deps.db, items: deps.items, events: deps.events, onItem: () => {}, onEvent: () => {} });
    http.requests.length = 0;
    await assignOnStart({ ...deps, writer }, item.id, API);
    expect(requestLines(http.requests)).toEqual(["GET /acme/_apis/connectionData", "PATCH /acme/_apis/wit/workitems/1234"]);
    expect(deps.events.forItem(item.id).map((e) => e.type)).toContain("item.assigned");
  });
});
