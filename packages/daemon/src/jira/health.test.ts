import { describe, expect, it } from "vitest";
import type { JiraConnectionConfig } from "../config/connections.js";
import { fixture } from "../test-support/fake-exec.js";
import { fakeHttp, json, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { jiraClient } from "./client.js";
import { jiraHealth, testJira } from "./health.js";

const TOKEN = "ATATT3xFfGF0-synthetic";
const cloud: JiraConnectionConfig = { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" };
const dc: JiraConnectionConfig = { id: "jira-dc", kind: "jira", backend: "api", baseUrl: "https://jira.acme.com/jira", deployment: "datacenter" };
const tokens = () => memoryTokens({ jira: TOKEN, "jira-dc": TOKEN });

describe("jiraClient", () => {
  it("signs in to Cloud with Basic email:token and speaks v3", async () => {
    const http = fakeHttp({ "GET /rest/api/3/myself": json(fixture("jira/cloud-myself.json")) });
    const client = jiraClient(cloud, http, tokens());
    expect(client.apiVersion).toBe("3");
    expect(await jiraHealth(client)).toEqual({ state: "ready", detail: "Dana Developer" });
    const [req] = http.requests;
    expect(req!.host).toBe("acme.atlassian.net");
    expect(req!.headers.authorization).toBe(`Basic ${Buffer.from(`dana@acme.com:${TOKEN}`).toString("base64")}`);
  });

  it("signs in to Data Center with a Bearer PAT, under its context path, and speaks v2", async () => {
    const http = fakeHttp({ "GET /jira/rest/api/2/myself": json(fixture("jira/dc-myself.json")) });
    expect(await jiraHealth(jiraClient(dc, http, tokens()))).toEqual({ state: "ready", detail: "Dana Developer" });
    expect(http.requests[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("calls nothing without a token", async () => {
    const http = fakeHttp({});
    expect(await jiraHealth(jiraClient(cloud, http, memoryTokens()))).toEqual({ state: "unauthorized", detail: "no API token in the Keychain" });
    expect(http.requests).toEqual([]);
  });

  it("is unauthorized on 401 with Jira's message, unreachable without an answer", async () => {
    const denied = fakeHttp({ "GET /rest/api/3/myself": json(fixture("jira/unauthorized.json"), 401) });
    expect(await jiraHealth(jiraClient(cloud, denied, tokens()))).toEqual({
      state: "unauthorized",
      detail: "Jira answered 401: You are not authenticated. Authentication required to perform this operation.",
    });
    const down = fakeHttp({ "GET /rest/api/3/myself": status(0, "getaddrinfo ENOTFOUND acme.atlassian.net") });
    expect(await jiraHealth(jiraClient(cloud, down, tokens()))).toEqual({ state: "unreachable", detail: "Jira did not answer: getaddrinfo ENOTFOUND acme.atlassian.net" });
  });

  it("reads Retry-After of a 429", async () => {
    const http = fakeHttp({ "GET /rest/api/3/myself": { status: 429, headers: { "retry-after": "30" }, body: "" } });
    expect(await jiraClient(cloud, http, tokens()).call("GET", "/rest/api/3/myself")).toEqual({
      ok: false, status: 429, failure: "rate_limited", error: "Jira answered 429", retryAfterSeconds: 30,
    });
  });

  it("never puts the token in an error", async () => {
    const http = fakeHttp({ "GET /rest/api/3/myself": status(500, "boom") });
    const r = await jiraClient(cloud, http, tokens()).call("GET", "/rest/api/3/myself");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("testJira", () => {
  it("checks serverInfo, then the account", async () => {
    const http = fakeHttp({
      "GET /rest/api/2/serverInfo": json(fixture("jira/cloud-server-info.json")),
      "GET /rest/api/3/myself": json(fixture("jira/cloud-myself.json")),
    });
    expect(await testJira(jiraClient(cloud, http, tokens()))).toEqual({ ok: true, state: "ready", detail: "Dana Developer", deployment: "cloud" });
  });

  it("names a Data Center site set up as Cloud instead of failing on the token", async () => {
    const http = fakeHttp({ "GET /jira/rest/api/2/serverInfo": json(fixture("jira/dc-server-info.json")) });
    const wrong = { ...dc, deployment: "cloud" as const, email: "dana@acme.com" };
    expect(await testJira(jiraClient(wrong, http, tokens()))).toEqual({
      ok: false, state: "unauthorized", detail: "https://jira.acme.com/jira is Jira Data Center: set the deployment to datacenter", deployment: "datacenter",
    });
    expect(http.requests.map((r) => r.path)).toEqual(["/jira/rest/api/2/serverInfo"]);
  });

  it("says why when the site does not answer", async () => {
    const http = fakeHttp({ "GET /jira/rest/api/2/serverInfo": status(0, "timeout"), "GET /jira/rest/api/2/myself": status(0, "timeout") });
    expect(await testJira(jiraClient(dc, http, tokens()))).toEqual({ ok: false, state: "unreachable", detail: "Jira did not answer: timeout" });
  });
});
