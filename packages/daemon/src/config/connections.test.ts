import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { connectionFor, connectionsOf, ConnectionsSchema, DEFAULT_CONNECTIONS } from "./connections.js";

const parse = (list: unknown) => ConnectionsSchema.safeParse(list);
const errors = (list: unknown) => {
  const r = parse(list);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("connections", () => {
  it("is github.com through gh without a connections key, and is not written back", () => {
    const config = parseConfig("{}");
    expect(config.connections).toBeUndefined();
    expect(connectionsOf(config)).toEqual([{ id: "github", kind: "github", backend: "cli", host: "github.com" }]);
    expect(JSON.stringify(config)).not.toContain("connections");
  });

  it("defaults the backend to cli and lower-cases the host", () => {
    const r = parse([{ id: "acme", kind: "github", host: "GitHub.Acme.com" }]);
    expect(r.success && r.data).toEqual([{ id: "acme", kind: "github", backend: "cli", host: "github.acme.com" }]);
  });

  it("refuses a backend the kind does not have", () => {
    expect(errors([{ id: "github", kind: "github", backend: "api", host: "github.com" }])).toEqual(["0.backend: this kind has no such backend yet"]);
  });

  it("refuses unknown kinds, bad ids and hosts, unknown fields and tokens", () => {
    expect(errors([{ id: "g", kind: "gitlab", host: "gitlab.com" }])).toHaveLength(1);
    expect(errors([{ id: "Acme Corp", kind: "github", host: "github.com" }])[0]).toMatch(/^0.id/);
    expect(errors([{ id: "a", kind: "github", host: "https://github.com/" }])[0]).toMatch(/^0.host/);
    expect(errors([{ id: "a", kind: "github", host: "github.com", token: "x" }])[0]).toMatch(/token/);
    expect(errors([])).toHaveLength(1);
  });

  it("refuses an id or a host used twice", () => {
    expect(errors([
      { id: "a", kind: "github", host: "github.com" },
      { id: "a", kind: "github", host: "github.acme.com" },
      { id: "b", kind: "github", host: "github.acme.com" },
    ])).toEqual(["1.id: id a is used twice", "2.host: host github.acme.com is used twice"]);
  });

  it("finds the connection by an origin's host", () => {
    expect(connectionFor(DEFAULT_CONNECTIONS, "github.com/acme/widgets")?.id).toBe("github");
    expect(connectionFor(DEFAULT_CONNECTIONS, "gitlab.com/acme/widgets")).toBeUndefined();
  });

  it("takes a Jira Cloud connection over the API, with the account's email", () => {
    const r = parse([{ id: "jira", kind: "jira", baseUrl: "https://acme.atlassian.net/", deployment: "cloud", email: "dev@acme.test" }]);
    expect(r.success && r.data).toEqual([{ id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dev@acme.test" }]);
  });

  it("takes a Jira Data Center connection with a context path and no email", () => {
    const r = parse([{ id: "jira", kind: "jira", baseUrl: "https://Jira.Acme.com/jira/", deployment: "datacenter" }]);
    expect(r.success && r.data).toEqual([{ id: "jira", kind: "jira", backend: "api", baseUrl: "https://jira.acme.com/jira", deployment: "datacenter" }]);
  });

  it("refuses a Jira connection without base URL, deployment, Cloud email, or over http or cli", () => {
    expect(errors([{ id: "jira", kind: "jira", deployment: "datacenter" }])[0]).toMatch(/^0.baseUrl/);
    expect(errors([{ id: "jira", kind: "jira", baseUrl: "https://acme.atlassian.net" }])[0]).toMatch(/^0.deployment/);
    expect(errors([{ id: "jira", kind: "jira", baseUrl: "https://acme.atlassian.net", deployment: "cloud" }])).toEqual([
      "0.email: Jira Cloud needs the email of the account the API token belongs to",
    ]);
    expect(errors([{ id: "jira", kind: "jira", baseUrl: "http://jira.acme.com", deployment: "datacenter" }])[0]).toMatch(/^0.baseUrl/);
    expect(errors([{ id: "jira", kind: "jira", baseUrl: "https://jira.acme.com?x=1", deployment: "datacenter" }])[0]).toMatch(/^0.baseUrl/);
    expect(errors([{ id: "jira", kind: "jira", backend: "cli", baseUrl: "https://jira.acme.com", deployment: "datacenter" }])).toEqual(["0.backend: this kind has no such backend yet"]);
    expect(errors([{ id: "jira", kind: "jira", baseUrl: "https://jira.acme.com", deployment: "datacenter", token: "x" }])[0]).toMatch(/token/);
  });

  it("refuses two connections to one Jira", () => {
    expect(errors([
      { id: "a", kind: "jira", baseUrl: "https://jira.acme.com", deployment: "datacenter" },
      { id: "b", kind: "jira", baseUrl: "https://jira.acme.com/", deployment: "datacenter" },
    ])).toEqual(["1.baseUrl: host jira.acme.com is used twice"]);
  });

  it("never finds a Jira connection for a repository origin", () => {
    const list = [...DEFAULT_CONNECTIONS, { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dev@acme.test" } as const];
    expect(connectionFor(list, "acme.atlassian.net/acme/widgets")).toBeUndefined();
  });

  it("takes an Azure DevOps organization through az or its API, on dev.azure.com (issue #141)", () => {
    const r = parse([
      { id: "github", kind: "github", host: "github.com" },
      { id: "ado", kind: "azure-devops", organization: "Acme" },
      { id: "contoso", kind: "azure-devops", backend: "api", organization: "contoso" },
    ]);
    expect(r.success && r.data.slice(1)).toEqual([
      { id: "ado", kind: "azure-devops", backend: "cli", host: "dev.azure.com", organization: "acme" },
      { id: "contoso", kind: "azure-devops", backend: "api", host: "dev.azure.com", organization: "contoso" },
    ]);
    expect(errors([{ id: "ado", kind: "azure-devops", organization: "acme", host: "acme.visualstudio.com" }])[0]).toMatch(/^0.host/);
    expect(errors([{ id: "ado", kind: "azure-devops" }])[0]).toMatch(/^0.organization/);
    expect(errors([{ id: "ado", kind: "azure-devops", organization: "acme corp" }])[0]).toMatch(/^0.organization/);
  });

  it("refuses an organization used twice, but lets organizations share dev.azure.com", () => {
    expect(errors([
      { id: "a", kind: "azure-devops", organization: "acme" },
      { id: "b", kind: "azure-devops", organization: "contoso" },
      { id: "c", kind: "azure-devops", backend: "api", organization: "acme" },
    ])).toEqual(["2.organization: organization acme is used twice"]);
  });

  it("finds an Azure DevOps origin's connection by its organization", () => {
    const list = [
      { id: "github", kind: "github", backend: "cli", host: "github.com" },
      { id: "ado", kind: "azure-devops", backend: "cli", host: "dev.azure.com", organization: "acme" },
    ] as const;
    expect(connectionFor(list, "dev.azure.com/acme/my project/legacy")?.id).toBe("ado");
    expect(connectionFor(list, "dev.azure.com/contoso/web/site")).toBeUndefined();
  });

  it("takes Azure DevOps origins, blanks and all, as sources once a connection serves them", () => {
    const config = (connection: object) => JSON.stringify({ connections: [connection], sources: { "dev.azure.com/acme/my project/legacy": { managed: true } } });
    expect(parseConfig(config({ id: "ado", kind: "azure-devops", organization: "acme" })).sources).toHaveProperty(["dev.azure.com/acme/my project/legacy"]);
    expect(() => parseConfig(config({ id: "github", kind: "github", host: "github.com" }))).toThrow(/Azure DevOps organization acme/);
  });
});
