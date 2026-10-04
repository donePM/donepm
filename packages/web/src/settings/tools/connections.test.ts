import { describe, expect, it } from "vitest";
import type { Settings, Status } from "../../api/types";
import { connectionId, offeredHosts, restartPending, withGitHubHost, DEFAULT_CONNECTIONS } from "./connections";

const status = (patch: Partial<Status>): Status => ({ version: "0", pid: 1, startedAt: "", runningAgents: 0, pollErrors: [], ...patch });
const settings = (patch: Partial<Settings>): Settings => ({ ...({} as Settings), ...patch });

describe("connections", () => {
  it("makes an id from a host that no other connection has", () => {
    expect(connectionId("github.acme.com", ["github"])).toBe("github-acme-com");
    expect(connectionId("github.acme.com", ["github-acme-com"])).toBe("github-acme-com-2");
  });

  it("offers the hosts gh is logged in to that no connection serves", () => {
    const s = status({ ghKnownHosts: ["github.acme.com", "github.com"] });
    expect(offeredHosts(s, settings({}))).toEqual(["github.acme.com"]);
    expect(offeredHosts(s, settings({ connections: withGitHubHost(DEFAULT_CONNECTIONS, "github.acme.com") }))).toEqual([]);
  });

  it("adds a GitHub host through gh to the default", () => {
    expect(withGitHubHost(DEFAULT_CONNECTIONS, "github.acme.com")).toEqual([
      { id: "github", kind: "github", backend: "cli", host: "github.com" },
      { id: "github-acme-com", kind: "github", backend: "cli", host: "github.acme.com" },
    ]);
  });

  it("knows a saved connection waits for a restart", () => {
    const running = status({ connections: [{ id: "github", kind: "github", backend: "cli", host: "github.com", state: "ready" }] });
    expect(restartPending(running, settings({}))).toBe(false);
    expect(restartPending(running, settings({ connections: withGitHubHost(DEFAULT_CONNECTIONS, "github.acme.com") }))).toBe(true);
  });
});
