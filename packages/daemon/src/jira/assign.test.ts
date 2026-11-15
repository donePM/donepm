import type { WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { JiraConnectionConfig } from "../config/connections.js";
import type { TicketSourceConfig } from "../config/ticket-sources.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { gitHubCliConnection } from "../gh/adapter.js";
import { assignOnStart } from "../gh/assign-on-start.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { providerRegistry } from "../providers/registry.js";
import { testCtx } from "../test-support/ctx.js";
import { fakeExec, fixture } from "../test-support/fake-exec.js";
import { fakeHttp, json } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { jiraConnection } from "./connection.js";

const API = "github.com/acme/api";
const cloud: JiraConnectionConfig = { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" };

const TICKET: WorkItem = {
  id: "item-1", source: "jira-issue", externalId: "jira:APP-123", externalUrl: "https://acme.atlassian.net/browse/APP-123",
  title: "T", body: "", labels: [], state: "running", playbook: "implement", priority: 1, repoCandidates: [API], repoOrigin: API,
  stateSince: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};

function setup(entries: TicketSourceConfig[]) {
  const db = openDb(":memory:");
  const items = new ItemStore(db);
  const events = new EventStore(db);
  items.insert(TICKET, API);
  const exec = fakeExec({});
  const http = fakeHttp({
    "GET /rest/api/3/myself": json(fixture("jira/cloud-myself.json")),
    "PUT /rest/api/3/issue/APP-123/assignee": { status: 204, headers: {}, body: "" },
  });
  const providers = providerRegistry([gitHubCliConnection(exec), jiraConnection(cloud, http, memoryTokens({ jira: "t" }), () => entries)]);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  // The repository's own setting is for its GitHub issues, not for tickets.
  const deps = { items, writer, providers, ctx: testCtx(), log: silentLog, sources: () => ({ [API]: { assignOnStart: true } }), ticketSources: () => entries };
  return { deps, events, http, exec };
}

describe("assign a ticket on start (issue #139)", () => {
  it("assigns it in Jira when its ticket source for the repository opted in", async () => {
    const { deps, events, http, exec } = setup([{ connection: "jira", repos: [API], assignOnStart: true }]);
    await assignOnStart(deps, "item-1", API);
    expect(http.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /rest/api/3/myself", "PUT /rest/api/3/issue/APP-123/assignee"]);
    expect(exec.calls).toEqual([]);
    expect(events.forItem("item-1")).toMatchObject([{ type: "item.assigned" }]);
  });

  it("leaves it alone otherwise", async () => {
    const { deps, events, http } = setup([{ connection: "jira", repos: [API] }, { connection: "jira", repos: ["github.com/acme/web"], assignOnStart: true }]);
    await assignOnStart(deps, "item-1", API);
    expect(http.requests).toEqual([]);
    expect(events.forItem("item-1")).toEqual([]);
  });
});
