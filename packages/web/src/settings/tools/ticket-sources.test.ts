import { describe, expect, it } from "vitest";
import type { RepoView, Settings } from "../../api/types";
import { cleanEntry, DEFAULT_JQL, entryProblem, jiraConnections, jiraSearchUrl, repoOrigins, withoutTicketSource, withTicketSource } from "./ticket-sources";

const APP = "github.com/acme/app";
const API = "github.com/acme/api";

describe("ticket sources (issue #139)", () => {
  it("links to Jira's own search with the query, or the default", () => {
    expect(jiraSearchUrl("https://acme.atlassian.net/", "project = APP AND sprint in openSprints()")).toBe(
      "https://acme.atlassian.net/issues/?jql=project%20%3D%20APP%20AND%20sprint%20in%20openSprints()",
    );
    expect(jiraSearchUrl("https://jira.acme.com/jira", " ")).toBe(`https://jira.acme.com/jira/issues/?jql=${encodeURIComponent(DEFAULT_JQL)}`);
  });

  it("offers only Jira connections", () => {
    const settings = {
      connections: [
        { id: "github", kind: "github", backend: "cli", host: "github.com" },
        { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" },
      ],
    } as Settings;
    expect(jiraConnections(settings).map((c) => c.id)).toEqual(["jira"]);
    expect(jiraConnections(undefined)).toEqual([]);
  });

  it("offers the clones by normalised origin", () => {
    const repos = [{ originUrl: "git@github.com:acme/app.git" }, { originUrl: "https://github.com/acme/api" }, { originUrl: "https://github.com/acme/app" }] as RepoView[];
    expect(repoOrigins(repos)).toEqual([API, APP]);
  });

  it("saves a blank or default query as none, and the flag only when on", () => {
    expect(cleanEntry({ connection: "jira", query: `  ${DEFAULT_JQL} `, repos: [APP, APP], assignOnStart: false })).toEqual({ connection: "jira", repos: [APP] });
    expect(cleanEntry({ connection: "jira", query: " project = APP ", repos: [APP], assignOnStart: true })).toEqual({
      connection: "jira", query: "project = APP", repos: [APP], assignOnStart: true,
    });
  });

  it("adds, replaces and removes entries", () => {
    const one = withTicketSource([], { connection: "jira", repos: [APP] });
    const two = withTicketSource(one, { connection: "jira", query: "project = API", repos: [API] });
    expect(withTicketSource(two, { connection: "jira", repos: [API, APP] }, 0)).toEqual([
      { connection: "jira", repos: [API, APP] },
      { connection: "jira", query: "project = API", repos: [API] },
    ]);
    expect(withoutTicketSource(two, 0)).toEqual([{ connection: "jira", query: "project = API", repos: [API] }]);
  });

  it("asks for a connection and a repository", () => {
    expect(entryProblem({ connection: "", repos: [APP] })).toMatch(/connection/);
    expect(entryProblem({ connection: "jira", repos: [] })).toMatch(/repository/);
    expect(entryProblem({ connection: "jira", repos: [APP] })).toBeUndefined();
  });
});
