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
    expect(errors([{ id: "j", kind: "jira", host: "acme.atlassian.net" }])).toHaveLength(1);
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
});
