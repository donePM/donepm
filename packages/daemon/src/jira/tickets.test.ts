import { describe, expect, it } from "vitest";
import type { JiraConnectionConfig } from "../config/connections.js";
import type { TicketSourceConfig } from "../config/ticket-sources.js";
import { fixture } from "../test-support/fake-exec.js";
import { fakeHttp, json, type FakeRequest } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { jiraClient } from "./client.js";
import { descriptionMarkdown } from "./search.js";
import { jiraTickets } from "./tickets.js";

const cloud: JiraConnectionConfig = { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" };
const dc: JiraConnectionConfig = { id: "jira-dc", kind: "jira", backend: "api", baseUrl: "https://jira.acme.com", deployment: "datacenter" };
const tokens = () => memoryTokens({ jira: "t", "jira-dc": "t" });
const APP = "github.com/acme/app";
const API = "github.com/acme/api";

const query = (r: FakeRequest) => new URL(`https://x${r.path}`).searchParams;

/** Cloud's two pages, chained by the token of the first. */
const cloudPages = (r: FakeRequest) =>
  json(fixture(query(r).get("nextPageToken") ? "jira/cloud-search-page2.json" : "jira/cloud-search-page1.json"));

const source = (config: JiraConnectionConfig, http: ReturnType<typeof fakeHttp>, entries: TicketSourceConfig[]) =>
  jiraTickets(jiraClient(config, http, tokens()), () => entries);

describe("Jira search (issue #139)", () => {
  it("reads every page of Cloud's enhanced search and maps each ticket", async () => {
    const http = fakeHttp({ "GET /rest/api/3/search/jql": cloudPages });
    const [search, ...rest] = await source(cloud, http, [{ connection: "jira", repos: [APP] }]).collect(() => []);
    expect(rest).toEqual([]);
    expect(search!.label).toBe('Jira "assignee = currentUser() AND statusCategory != Done"');
    expect(http.requests.map((r) => Object.fromEntries(query(r)))).toEqual([
      {
        jql: "assignee = currentUser() AND statusCategory != Done",
        fields: "summary,description,priority,status,labels,components,issuetype,project,created,updated,assignee",
        maxResults: "100",
        expand: "renderedFields",
      },
      expect.objectContaining({ nextPageToken: "Ch0jU3RyaW5nJkFQUA%3D%3D" }),
    ]);
    if (!search!.result.ok) throw new Error(search!.result.error);
    // APP-141 is in a done status: it is not open work, whatever the query said.
    expect(search!.result.issues.map((i) => i.externalId)).toEqual(["jira:APP-123", "jira:APP-140"]);
    expect(search!.result.issues[0]).toEqual({
      repository: "APP",
      number: 123,
      externalId: "jira:APP-123",
      source: "jira-issue",
      url: "https://acme.atlassian.net/browse/APP-123",
      title: "Login fails after password reset",
      body: "After a reset the login form says the password is **wrong**.\n\n-   Reset the password\n-   Log in\n\n[APP-100](https://acme.atlassian.net/browse/APP-100)",
      labels: ["auth", "regression", "Web", "Bug"],
      createdAt: "2026-09-28T07:15:02.123Z",
      priorityTier: 1,
      origins: [APP],
    });
    expect(search!.result.issues[1]).toMatchObject({ body: "", labels: ["Story"], priorityTier: 2 });
  });

  it("pages Data Center's search by startAt", async () => {
    const http = fakeHttp({ "GET /rest/api/2/search": json(fixture("jira/dc-search.json")) });
    const [search] = await source(dc, http, [{ connection: "jira-dc", query: "project = OPS", repos: [API] }]).collect(() => []);
    expect(http.requests).toHaveLength(1);
    expect(Object.fromEntries(query(http.requests[0]!))).toMatchObject({ jql: "project = OPS", startAt: "0", maxResults: "100", expand: "renderedFields" });
    if (!search!.result.ok) throw new Error(search!.result.error);
    expect(search!.result.issues[0]).toMatchObject({
      externalId: "jira-dc:OPS-7",
      url: "https://jira.acme.com/browse/OPS-7",
      body: "The cache grows without bound.\n\n-   weekly\n-   keep 3",
      labels: ["infra", "CI", "Task"],
      priorityTier: 0,
    });
  });

  it("sends a ticket two searches find to the repositories of both", async () => {
    const http = fakeHttp({ "GET /rest/api/3/search/jql": cloudPages });
    const searches = await source(cloud, http, [
      { connection: "jira", repos: [APP] },
      { connection: "jira", query: "project = APP", repos: [API, APP] },
      { connection: "other", repos: ["github.com/acme/web"] },
    ]).collect(() => []);
    expect(searches).toHaveLength(2);
    for (const s of searches) if (s.result.ok) expect(s.result.issues[0]!.origins).toEqual([APP, API]);
  });

  it("stops at a 429 and searches nothing more this poll", async () => {
    const http = fakeHttp({ "GET /rest/api/3/search/jql": { status: 429, headers: { "retry-after": "60" }, body: "" } });
    const searches = await source(cloud, http, [
      { connection: "jira", repos: [APP] },
      { connection: "jira", query: "project = APP", repos: [API] },
    ]).collect(() => []);
    expect(http.requests).toHaveLength(1);
    expect(searches.map((s) => s.result)).toEqual([{ ok: false, kind: "command", error: "rate limited (retry after 60s)" }]);
  });

  it("calls an answer of another shape a schema failure", async () => {
    const http = fakeHttp({ "GET /rest/api/3/search/jql": json({ issues: [{ id: "1" }] }) });
    const [search] = await source(cloud, http, [{ connection: "jira", repos: [APP] }]).collect(() => []);
    expect(search!.result).toMatchObject({ ok: false, kind: "schema", raw: '{"issues":[{"id":"1"}]}' });
  });

  it("runs a query for one repository", async () => {
    const http = fakeHttp({ "GET /rest/api/2/search": json(fixture("jira/dc-search.json")) });
    const r = await source(dc, http, []).query(APP, "project = OPS");
    expect(r.ok && r.issues.map((i) => i.origins)).toEqual([[APP]]);
  });
});

describe("descriptionMarkdown", () => {
  it("drops what could run and keeps the text", () => {
    expect(descriptionMarkdown('<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><form><input></form>')).toBe("a");
    expect(descriptionMarkdown(null)).toBe("");
  });
});

describe("Jira ticket states", () => {
  it("asks for many keys in one search, by status category", async () => {
    const http = fakeHttp({ "GET /rest/api/3/search/jql": json(fixture("jira/cloud-states.json")) });
    const states = await source(cloud, http, []).states!([
      { externalId: "jira:APP-123", origin: APP },
      { externalId: "jira:APP-140", origin: APP },
      { externalId: "jira-dc:OPS-7", origin: APP },
    ]);
    expect(states).toEqual(new Map([["jira:APP-123", "CLOSED"], ["jira:APP-140", "OPEN"]]));
    expect(Object.fromEntries(query(http.requests[0]!))).toMatchObject({ jql: "key in (APP-123,APP-140)", fields: "status" });
    expect(query(http.requests[0]!).has("expand")).toBe(false);
  });

  it("splits more than 100 keys", async () => {
    const http = fakeHttp({ "GET /rest/api/3/search/jql": json({ issues: [], isLast: true }) });
    const refs = Array.from({ length: 150 }, (_, i) => ({ externalId: `jira:APP-${i + 1}`, origin: APP }));
    await source(cloud, http, []).states!(refs);
    expect(http.requests.map((r) => query(r).get("jql")!.split(",").length)).toEqual([100, 50]);
  });

  it("asks key by key when Jira refuses a key it does not know, and leaves that one undecided", async () => {
    const http = fakeHttp({
      "GET /rest/api/2/search": json(fixture("jira/dc-unknown-key.json"), 400),
      "GET /rest/api/2/issue/OPS-7": json({ key: "OPS-7", fields: { status: { statusCategory: { key: "done" } } } }),
      "GET /rest/api/2/issue/OPS-9": json(fixture("jira/dc-unknown-key.json"), 404),
    });
    const states = await source(dc, http, []).states!([
      { externalId: "jira-dc:OPS-7", origin: API },
      { externalId: "jira-dc:OPS-9", origin: API },
    ]);
    expect(states).toEqual(new Map([["jira-dc:OPS-7", "CLOSED"]]));
  });
});

describe("assign on start through Jira", () => {
  it("assigns by account id on Cloud", async () => {
    const http = fakeHttp({
      "GET /rest/api/3/myself": json(fixture("jira/cloud-myself.json")),
      "PUT /rest/api/3/issue/APP-123/assignee": { status: 204, headers: {}, body: "" },
    });
    expect(await source(cloud, http, []).assignToMe({ externalId: "jira:APP-123", origin: APP })).toEqual({ ok: true });
    expect(http.requests[1]!.body).toEqual({ accountId: "5f0000000000000000000a01" });
  });

  it("assigns by user name on Data Center and says why it could not", async () => {
    const http = fakeHttp({
      "GET /rest/api/2/myself": json(fixture("jira/dc-myself.json")),
      "PUT /rest/api/2/issue/OPS-7/assignee": json({ errorMessages: [], errors: { assignee: "User 'dana' cannot be assigned issues." } }, 400),
    });
    expect(await source(dc, http, []).assignToMe({ externalId: "jira-dc:OPS-7", origin: API })).toEqual({
      ok: false,
      error: "Jira answered 400: assignee: User 'dana' cannot be assigned issues.",
    });
    expect(http.requests[1]!.body).toEqual({ name: "dana" });
  });

  it("refuses a ticket of another connection", async () => {
    const http = fakeHttp({});
    expect(await source(cloud, http, []).assignToMe({ externalId: "jira-dc:OPS-7", origin: API })).toMatchObject({ ok: false });
    expect(http.requests).toEqual([]);
  });
});
