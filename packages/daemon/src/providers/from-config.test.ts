import { describe, expect, it } from "vitest";
import { DEFAULT_CONNECTIONS } from "../config/connections.js";
import { fakeExec, ok } from "../test-support/fake-exec.js";
import { fakeHttp } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { providersOf } from "./from-config.js";

const deps = (exec = fakeExec({})) => ({ exec, http: fakeHttp({}), tokens: memoryTokens() });

describe("providersOf", () => {
  it("has github.com through gh without a connections config", () => {
    const providers = providersOf(DEFAULT_CONNECTIONS, deps());
    expect(providers.connections.map(({ id, kind, backend, host }) => ({ id, kind, backend, host }))).toEqual([
      { id: "github", kind: "github", backend: "cli", host: "github.com" },
    ]);
    expect(providers.codeHost("github.com/acme/widgets")).toBeDefined();
    expect(providers.codeHost("github.acme.com/team/api")).toBeUndefined();
  });

  it("serves each configured GitHub host through gh, on that host", async () => {
    const exec = fakeExec({ "gh pr view": ok('{"state":"OPEN","mergedAt":null,"mergeable":"MERGEABLE","baseRefName":"main"}') });
    const providers = providersOf([
      { id: "github", kind: "github", backend: "cli", host: "github.com" },
      { id: "acme", kind: "github", backend: "cli", host: "github.acme.com" },
    ], deps(exec));
    expect(providers.connections.map((c) => c.id)).toEqual(["github", "acme"]);
    await providers.codeHost("github.acme.com/team/api")!.prState({ number: 3, url: "https://github.acme.com/team/api/pull/3" });
    expect(exec.calls[0]!.args.join(" ")).toContain("github.acme.com/team/api");
  });

  it("serves a Jira connection over its API on its base URL's host, never as a code host", () => {
    const providers = providersOf([
      ...DEFAULT_CONNECTIONS,
      { id: "jira", kind: "jira", backend: "api", baseUrl: "https://jira.acme.com/jira", deployment: "datacenter" },
    ], deps());
    const jira = providers.connections.find((c) => c.id === "jira")!;
    expect({ kind: jira.kind, backend: jira.backend, host: jira.host }).toEqual({ kind: "jira", backend: "api", host: "jira.acme.com" });
    expect(jira.health).toBeDefined();
    expect(providers.codeHost("jira.acme.com/acme/widgets")).toBeUndefined();
  });
});
