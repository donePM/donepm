import { describe, expect, it } from "vitest";
import { gitHubCliConnection } from "../gh/adapter.js";
import { StatusStore } from "../status/status.js";
import { fakeExec } from "../test-support/fake-exec.js";
import { connectionStatuses, isReady, readyProviders } from "./connection-status.js";
import type { TokenStore } from "./keychain.js";
import { providerRegistry, type Connection } from "./registry.js";

const exec = fakeExec({});
const github = gitHubCliConnection(exec);
const acme = gitHubCliConnection(exec, "github.acme.com", "acme");
const other = gitHubCliConnection(exec, "acme.ghe.com", "ghe");
const jira: Connection = { id: "jira", kind: "jira", backend: "api", host: "acme.atlassian.net" };

function statusWith() {
  const store = new StatusStore("0.0.0", "2026-10-04T00:00:00Z", 1);
  store.update({
    gh: { state: "ready", path: "/bin/gh", account: "octo" },
    ghHosts: { "github.acme.com": { state: "not_logged_in", path: "/bin/gh" } },
  });
  return store.get();
}

function tokens(set: string[]): TokenStore & { read: () => never } {
  return {
    read: () => {
      throw new Error("the status never reads a token");
    },
    has: async (id) => set.includes(id),
    write: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
  };
}

describe("connectionStatuses", () => {
  it("is where gh stands for each cli connection's host", async () => {
    expect(await connectionStatuses([github, acme, other], statusWith(), tokens([]))).toEqual([
      { id: "github", kind: "github", backend: "cli", host: "github.com", state: "ready", detail: "octo" },
      { id: "acme", kind: "github", backend: "cli", host: "github.acme.com", state: "not_logged_in" },
      { id: "ghe", kind: "github", backend: "cli", host: "acme.ghe.com", state: "not_installed" },
    ]);
  });

  it("is unauthorized for an api connection without a token, ready with one, never reading it", async () => {
    expect(await connectionStatuses([jira], statusWith(), tokens([]))).toEqual([
      { id: "jira", kind: "jira", backend: "api", host: "acme.atlassian.net", tokenSet: false, state: "unauthorized", detail: "no API token in the Keychain" },
    ]);
    expect((await connectionStatuses([jira], statusWith(), tokens(["jira"])))[0]).toMatchObject({ state: "ready", tokenSet: true });
  });

  it("is what the provider says of a set token", async () => {
    const health = async () => ({ state: "unauthorized" as const, detail: "Jira answered 401" });
    expect((await connectionStatuses([{ ...jira, health }], statusWith(), tokens(["jira"])))[0]).toMatchObject({
      tokenSet: true, state: "unauthorized", detail: "Jira answered 401",
    });
  });
});

describe("readyProviders", () => {
  it("keeps only the connections whose host gh is logged in to", () => {
    const status = statusWith();
    expect(isReady(status, github)).toBe(true);
    expect(isReady(status, acme)).toBe(false);
    const ready = readyProviders(providerRegistry([github, acme]), status);
    expect(ready.connections.map((c) => c.id)).toEqual(["github"]);
    expect(ready.codeHost("https://github.com/acme/widgets/pull/7")).toBe(github.codeHost);
    expect(ready.codeHost("https://github.acme.com/team/api/pull/3")).toBeUndefined();
  });
});
