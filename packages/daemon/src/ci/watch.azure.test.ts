import { draftCreated, draftExecuted, start, type CiCheck, type Ctx, type WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { azureDevOpsConnection } from "../azure/connection.js";
import type { PipelinesOptIn } from "../config/pipelines.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { gitHubCliConnection } from "../gh/adapter.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { providerRegistry } from "../providers/registry.js";
import { fakeExec, fixture } from "../test-support/fake-exec.js";
import { fakeHttp, json, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { watchCi } from "./watch.js";

const T0 = "2026-10-03T19:47:00.000Z";
const GHE_PR = { url: "https://github.acme.com/team/api/pull/9", number: 9 };
const ADO_PR = { url: "https://dev.azure.com/acme/Platform/_git/legacy/pullrequest/123", number: 123 };
const PROJECT_ID = "0b2d9c3e-5c3f-4a4f-9f0e-6b1f2f7c1a11";
const HEAD = "b60280bc6e62e2f880f1b63c1e24987664d3bda3";

/** Build `id` of `project` failed in two jobs: its timeline and the logs of its failed tasks. */
function build(project: string, id: number) {
  const at = `GET /acme/${project}/_apis/build/builds/${id}`;
  return {
    [`${at}/timeline`]: json(fixture("azure-devops/build-timeline-failed.json")),
    [`${at}/logs/7`]: status(200, fixture("azure-devops/build-log-tests.txt")),
    [`${at}/logs/9`]: json(fixture("azure-devops/build-log-lint.json")),
  };
}

/**
 * An item on branch `dp/7-fix-the-build` whose pull request `pr` was just opened, so it waits for
 * CI since T0; GitHub Enterprise answers through `gh`, the Azure DevOps organization `acme` over REST.
 */
function setup(pr: { url: string; number: number }, origin: string, ghe: Record<string, string>, ado: Parameters<typeof fakeHttp>[0]) {
  const db = openDb(":memory:");
  let n = 0;
  const ctx: Ctx = { now: () => "2026-10-03T19:55:00.000Z", newId: () => `id-${++n}` };
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "team/api#7", externalUrl: "https://github.acme.com/team/api/issues/7",
    title: "CI", body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
    stateSince: T0, createdAt: T0, updatedAt: T0, branch: "dp/7-fix-the-build", worktreePath: "/w/7",
  };
  items.insert(item, origin);
  const at0: Ctx = { ...ctx, now: () => T0 };
  let current = writer.commit(start(item, at0));
  current = writer.commit(draftCreated(current, at0, "d-1"));
  writer.commit(draftExecuted(current, at0, "d-1", pr, { ...pr }));
  const exec = fakeExec(Object.fromEntries(Object.entries(ghe).map(([k, v]) => [k, { code: 1, stdout: fixture(v), stderr: "" }])));
  const http = fakeHttp(ado);
  const providers = providerRegistry([
    gitHubCliConnection(exec, "github.acme.com", "ghe"),
    azureDevOpsConnection({ id: "ado", organization: "acme", backend: "api", exec, http, tokens: memoryTokens({ ado: "pat" }) }),
  ]);
  const seen: CiCheck[][] = [];
  return {
    deps: { items, events, writer, providers, ctx, log: silentLog, onChecks: (_: string, checks: CiCheck[]) => seen.push(checks) },
    exec,
    http,
    seen,
    item: () => items.get(item.id)!.item,
    last: () => events.forItem(item.id).at(-1)!,
  };
}

describe("watchCi with Azure Pipelines (issue #143)", () => {
  it("counts a GitHub Enterprise pull request's Azure Pipelines checks once and reads their logs from Azure DevOps", async () => {
    const t = setup(GHE_PR, "github.acme.com/team/api", { "gh pr checks 9": "gh/pr-checks-azure.json" }, build(PROJECT_ID, 812));
    await watchCi(t.deps);
    expect(t.seen[0]!.map((c) => c.name)).toEqual(["lint", "acme.api", "acme.api (Unit tests)"]);
    expect(t.item().state).toBe("needs_you");
    const e = t.last();
    expect(e.type).toBe("ci.failed");
    expect((e.payload.failed as any[]).map((c) => c.name)).toEqual(["acme.api", "acme.api (Unit tests)"]);
    const logs = e.payload.logs as Array<{ name: string; tail: string }>;
    expect(logs.map((l) => l.name)).toEqual(["acme.api", "acme.api (Unit tests)"]);
    expect(logs[0]!.tail).toContain("── Run lint ──");
    expect(logs[1]!.tail).toContain("AssertionError: expected 107 to be 108");
    expect(logs[1]!.tail).not.toContain("Run lint");
    // No GitHub Actions log for a build that is not one, and the build's timeline read once.
    expect(t.exec.calls.filter((c) => c.args[0] === "run")).toEqual([]);
    expect(t.http.requests.filter((r) => r.path.includes("/timeline"))).toHaveLength(1);
  });

  it("judges an Azure Repos pull request by its build and status policies", async () => {
    const t = setup(ADO_PR, "dev.azure.com/acme/platform/legacy", {}, {
      "GET /acme/platform/_apis/git/repositories/legacy/pullrequests/123": json(fixture("azure-devops/pr-active.json")),
      "GET /acme/platform/_apis/policy/evaluations": json(fixture("azure-devops/policy-evaluations-fail.json")),
      ...build("platform", 812),
    });
    await watchCi(t.deps);
    expect(t.seen[0]!.map((c) => [c.name, c.bucket])).toEqual([["api CI", "fail"], ["security/scan", "pass"]]);
    expect(t.last()).toMatchObject({ type: "ci.failed", payload: { ...ADO_PR, failed: [{ name: "api CI" }], logs: [{ name: "api CI" }] } });
    expect(t.exec.calls).toEqual([]);
  });

  it("passes an Azure Repos pull request whose policies passed", async () => {
    const t = setup(ADO_PR, "dev.azure.com/acme/platform/legacy", {}, {
      "GET /acme/platform/_apis/git/repositories/legacy/pullrequests/123": json(fixture("azure-devops/pr-active.json")),
      "GET /acme/platform/_apis/policy/evaluations": json(fixture("azure-devops/policy-evaluations-pass.json")),
    });
    await watchCi(t.deps);
    expect(t.item().state).toBe("done");
    expect(t.last()).toMatchObject({ type: "ci.passed", payload: { checks: 2 } });
  });

  it("reads an opted-in repository's builds of the head commit by branch, never its pull request's checks", async () => {
    const t = setup(GHE_PR, "github.acme.com/team/api", { "gh pr checks 9": "gh/pr-checks-azure.json" }, {
      "GET /acme/platform/_apis/build/builds": json(fixture("azure-devops/builds-by-branch.json")),
      ...build("platform", 831),
    });
    const optIn: PipelinesOptIn = { organization: "acme", project: "Platform", definitions: [41, 77] };
    const heads: string[] = [];
    await watchCi({
      ...t.deps,
      pipelinesOf: (origin) => (origin === "github.acme.com/team/api" ? optIn : undefined),
      headOf: async (item) => (heads.push(item.worktreePath!), HEAD),
    });
    expect(heads).toEqual(["/w/7"]);
    expect(t.exec.calls).toEqual([]);
    expect(t.seen[0]!.map((c) => [c.name, c.bucket])).toEqual([["acme.api", "fail"]]);
    expect(t.last()).toMatchObject({ type: "ci.failed", payload: { failed: [{ name: "acme.api" }], logs: [{ name: "acme.api" }] } });
    const asked = new URL(`https://x${t.http.requests[0]!.path}`);
    expect(asked.searchParams.get("branchName")).toBe("refs/heads/dp/7-fix-the-build");
  });

  it("keeps waiting when no connection serves the opted-in organization", async () => {
    const t = setup(GHE_PR, "github.acme.com/team/api", { "gh pr checks 9": "gh/pr-checks-azure.json" }, {});
    await watchCi({ ...t.deps, pipelinesOf: () => ({ organization: "globex", project: "web", definitions: [1] }) });
    expect(t.item().state).toBe("checking");
    expect(t.exec.calls).toEqual([]);
  });
});
