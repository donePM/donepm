import { describe, expect, it } from "vitest";
import type { Settings, Status } from "../../api/types";
import { connectionId, connectionRows, offeredHosts, restartPending, withAzureDevOps, withGitHubHost, withJira, withoutConnection, DEFAULT_CONNECTIONS } from "./connections";

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

  it("adds a Jira site as `jira`, with the email only for Cloud", () => {
    const cloud = withJira(DEFAULT_CONNECTIONS, { baseUrl: " https://acme.atlassian.net ", deployment: "cloud", email: "dana@acme.com" });
    expect(cloud[1]).toEqual({ id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" });
    const dc = withJira(cloud, { baseUrl: "https://jira.acme.com", deployment: "datacenter", email: "dana@acme.com" });
    expect(dc[2]).toEqual({ id: "jira-2", kind: "jira", backend: "api", baseUrl: "https://jira.acme.com", deployment: "datacenter" });
    expect(withoutConnection(dc, "jira").map((c) => c.id)).toEqual(["github", "jira-2"]);
  });

  it("lists every saved connection, with its running status once the daemon has it", () => {
    const running = status({ connections: [{ id: "github", kind: "github", backend: "cli", host: "github.com", state: "ready" }] });
    const saved = settings({ connections: withJira(DEFAULT_CONNECTIONS, { baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "d@acme.com" }) });
    const rows = connectionRows(running, saved);
    expect(rows.map((r) => [r.config.id, r.host, r.status?.state])).toEqual([["github", "github.com", "ready"], ["jira", "acme.atlassian.net", undefined]]);
    expect(restartPending(running, saved)).toBe(true);
    const both = status({ connections: [...running.connections!, { id: "jira", kind: "jira", backend: "api", host: "acme.atlassian.net", state: "unauthorized", tokenSet: false }] });
    expect(restartPending(both, saved)).toBe(false);
  });

  it("adds an Azure DevOps organization as `ado`, shown with its organization (issue #141)", () => {
    const saved = withAzureDevOps(DEFAULT_CONNECTIONS, { organization: " Acme ", backend: "api" });
    expect(saved[1]).toEqual({ id: "ado", kind: "azure-devops", backend: "api", host: "dev.azure.com", organization: "acme" });
    expect(withAzureDevOps(saved, { organization: "contoso", backend: "cli" })[2]!.id).toBe("ado-2");
    const running = status({
      connections: [
        { id: "github", kind: "github", backend: "cli", host: "github.com", state: "ready" },
        { id: "ado", kind: "azure-devops", backend: "api", host: "dev.azure.com", state: "unauthorized", tokenSet: false },
      ],
    });
    expect(connectionRows(running, settings({ connections: saved }))[1]!.host).toBe("dev.azure.com/acme");
    expect(restartPending(running, settings({ connections: saved }))).toBe(false);
  });
});
