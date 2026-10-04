import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config.js";
import { DEFAULT_JQL, DEFAULT_PROJECT_WIQL, DEFAULT_WIQL, queryOf } from "./ticket-sources.js";

const connections = [
  { id: "github", kind: "github", host: "github.com" },
  { id: "jira", kind: "jira", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "jamal@acme.example" },
  { id: "ado", kind: "azure-devops", organization: "acme" },
];

const parse = (ticketSources: unknown[]) => parseConfig(JSON.stringify({ connections, ticketSources }));

describe("ticketSources for Azure Boards (issue #142)", () => {
  it("takes an Azure DevOps connection with a project, for GitHub and Azure Repos repositories", () => {
    const entry = { connection: "ado", project: "Platform", repos: ["github.com/acme/widgets", "dev.azure.com/acme/platform/legacy"], assignOnStart: true };
    expect(parse([entry]).ticketSources).toEqual([entry]);
  });

  it("keeps the project to Azure Boards", () => {
    expect(() => parse([{ connection: "jira", project: "APP", repos: ["github.com/acme/widgets"] }])).toThrow(/"project" is for Azure Boards/);
  });

  it("still refuses a GitHub connection", () => {
    expect(() => parse([{ connection: "github", repos: ["github.com/acme/widgets"] }])).toThrow(ConfigError);
  });
});

describe("queryOf", () => {
  it("fills in each provider's default", () => {
    expect(queryOf({ connection: "jira", repos: [] })).toBe(DEFAULT_JQL);
    expect(queryOf({ connection: "ado", repos: [] }, "azure-devops")).toBe(DEFAULT_WIQL);
    expect(queryOf({ connection: "ado", project: "Platform", repos: [] }, "azure-devops")).toBe(DEFAULT_PROJECT_WIQL);
    expect(queryOf({ connection: "ado", query: "SELECT [System.Id] FROM WorkItems", repos: [] }, "azure-devops")).toBe("SELECT [System.Id] FROM WorkItems");
  });

  it("limits the default to the project with @project", () => {
    expect(DEFAULT_PROJECT_WIQL).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Completed', 'Cut') ORDER BY [System.ChangedDate] DESC",
    );
  });
});
