import { describe, expect, it } from "vitest";
import { DEFAULT_CONNECTIONS } from "../config/connections.js";
import { fakeExec, ok } from "../test-support/fake-exec.js";
import { providersOf } from "./from-config.js";

describe("providersOf", () => {
  it("has github.com through gh without a connections config", () => {
    const providers = providersOf(DEFAULT_CONNECTIONS, fakeExec({}));
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
    ], exec);
    expect(providers.connections.map((c) => c.id)).toEqual(["github", "acme"]);
    await providers.codeHost("github.acme.com/team/api")!.prState({ number: 3, url: "https://github.acme.com/team/api/pull/3" });
    expect(exec.calls[0]!.args.join(" ")).toContain("github.acme.com/team/api");
  });
});
