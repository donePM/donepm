import { collect, type SourceIssue } from "@donepm/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { JiraConnectionConfig } from "../config/connections.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { chooseRepo } from "../items/repo-choice.js";
import { ItemStore } from "../items/store.js";
import { jiraConnection } from "../jira/connection.js";
import { providerRegistry } from "../providers/registry.js";
import { RepoStore } from "../repos/store.js";
import { testCtx } from "../test-support/ctx.js";
import { fixture } from "../test-support/fake-exec.js";
import { fakeHttp, json } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { ticketRoutes } from "./ticket-routes.js";

const APP = "github.com/acme/app";
const API = "github.com/acme/api";
const cloud: JiraConnectionConfig = { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" };

const ticket: SourceIssue = {
  repository: "APP", number: 123, externalId: "jira:APP-123", source: "jira-issue", url: "https://acme.atlassian.net/browse/APP-123",
  title: "Login fails", body: "", labels: [], createdAt: "2026-09-28T07:15:02.123Z", origins: [APP, API],
};

function setup() {
  const db = openDb(":memory:");
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const repos = new RepoStore(db);
  repos.upsert({ id: "r-api", path: "/src/api", originUrl: API, defaultBranch: "main" }, "2026-10-01T00:00:00.000Z");
  const ctx = testCtx();
  const writer = itemWriter({ db, items, events, onItem: () => undefined, onEvent: () => undefined });
  const c = collect(ticket, ctx);
  items.insert(c.item, "");
  events.append(c.events);
  const http = fakeHttp({ "GET /rest/api/3/search/jql": json(fixture("jira/cloud-search-page2.json")) });
  const server = Fastify();
  ticketRoutes(server, {
    providers: providerRegistry([jiraConnection(cloud, http, memoryTokens({ jira: "t" }))]),
    chooseRepo: (id, origin) => chooseRepo({ items, repos, writer, ctx }, id, origin),
    view: (item) => item,
  });
  return { server, items, events, id: c.item.id, http };
}

describe("ticket routes (issue #139)", () => {
  it("records the user's choice of repository and links the clone", async () => {
    const { server, items, events, id } = setup();
    const r = await server.inject({ method: "POST", url: `/api/items/${id}/repo`, payload: { origin: API } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ repoOrigin: API, repoId: "r-api" });
    expect(items.get(id)!.originUrl).toBe(API);
    expect(events.forItem(id).map((e) => [e.type, e.actor, e.payload])).toEqual([
      ["item.collected", "system", expect.anything()],
      ["item.repo_chosen", "user", { origin: API }],
    ]);
  });

  it("refuses a repository the ticket does not go to, and one chosen after the start", async () => {
    const { server, items, id } = setup();
    const other = await server.inject({ method: "POST", url: `/api/items/${id}/repo`, payload: { origin: "github.com/acme/web" } });
    expect(other.statusCode).toBe(400);
    items.update({ ...items.get(id)!.item, repoOrigin: APP, startedAt: "2026-10-02T00:00:00.000Z" });
    const late = await server.inject({ method: "POST", url: `/api/items/${id}/repo`, payload: { origin: API } });
    expect(late.statusCode).toBe(409);
    expect((await server.inject({ method: "POST", url: "/api/items/nope/repo", payload: { origin: API } })).statusCode).toBe(404);
  });

  it("tests a query and shows what it finds", async () => {
    const { server, http } = setup();
    const r = await server.inject({ method: "POST", url: "/api/ticket-sources/test", payload: { connection: "jira", query: "project = APP" } });
    expect(r.json()).toEqual({
      ok: true,
      count: 1,
      issues: [{ externalId: "jira:APP-140", title: "Export the report as CSV", url: "https://acme.atlassian.net/browse/APP-140" }],
    });
    expect(new URL(`https://x${http.requests[0]!.path}`).searchParams.get("jql")).toBe("project = APP");
    const unknown = await server.inject({ method: "POST", url: "/api/ticket-sources/test", payload: { connection: "jira-2" } });
    expect(unknown.statusCode).toBe(409);
  });
});
