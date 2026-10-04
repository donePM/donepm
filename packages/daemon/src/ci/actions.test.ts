import { ciFailed, draftCreated, draftExecuted, start, type WorkItem } from "@donepm/core";
import { githubProviders } from "../gh/adapter.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fakeHttp, json, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureDevOpsConnection } from "../azure/connection.js";
import { gitHubCliConnection } from "../gh/adapter.js";
import { providerRegistry } from "../providers/registry.js";
import { CiActionError, fixCi, markCiDone, rerunCi } from "./actions.js";

const PR = { url: "https://github.com/acme/widgets/pull/45", number: 45 };
const FAILED = [
  { name: "test (node 22)", link: "https://github.com/acme/widgets/actions/runs/7/job/1" },
  { name: "test (node 24)", link: "https://github.com/acme/widgets/actions/runs/7/job/2" },
];

/** An item waiting for CI; `red` lets that CI fail. */
function setup(red = true, failed: Array<{ name: string; link?: string }> = FAILED) {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "acme/widgets#45", externalUrl: "https://github.com/acme/widgets/issues/45",
    title: "Fix", body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
    stateSince: ctx.now(), createdAt: ctx.now(), updatedAt: ctx.now(), agentSessionId: "s1",
  };
  items.insert(item, "github.com/acme/widgets");
  let current = writer.commit(start(item, ctx));
  current = writer.commit(draftCreated(current, ctx, "d-1"));
  current = writer.commit(draftExecuted(current, ctx, "d-1", PR, { ...PR }));
  if (red) writer.commit(ciFailed(current, ctx, { ...PR, failed, logs: [{ name: "test (node 22)", tail: "expected 1 to be 2" }] }));
  const exec = fakeExec({ "gh run rerun": ok("") });
  return { deps: { items, events, writer, ctx, providers: githubProviders(exec) }, exec, item: () => items.get(item.id)!.item, last: () => events.forItem(item.id).at(-1)! };
}

describe("rerunCi", () => {
  it("reruns the failed jobs of each run once and waits for CI again", async () => {
    const t = setup();
    expect((await rerunCi(t.deps, "item-1")).state).toBe("checking");
    expect(t.exec.calls.map((c) => c.args.join(" "))).toEqual(["run rerun 7 --failed --repo github.com/acme/widgets"]);
    expect(t.last()).toMatchObject({ type: "ci.started", actor: "user", payload: { ...PR, reason: "rerun", runs: ["7"] } });
  });

  it("refuses without a red CI and reports gh failures", async () => {
    await expect(rerunCi(setup(false).deps, "item-1")).rejects.toMatchObject({ status: 409 });
    await expect(rerunCi(setup().deps, "nope")).rejects.toMatchObject({ status: 404 });
    const t = setup();
    await expect(rerunCi({ ...t.deps, providers: githubProviders(fakeExec({ "gh run rerun": fail("run is still in progress") })) }, "item-1")).rejects.toEqual(
      new CiActionError(502, "run is still in progress"),
    );
    expect(t.item().state).toBe("needs_you");
  });
});

describe("rerunCi of Azure Pipelines builds (issue #143)", () => {
  const BUILD = "https://dev.azure.com/acme/0b2d9c3e-5c3f-4a4f-9f0e-6b1f2f7c1a11/_build/results?buildId=812";
  const AT = "/acme/0b2d9c3e-5c3f-4a4f-9f0e-6b1f2f7c1a11/_apis/build/builds/812";

  it("retries the build's failed stages through its organization's connection, and Actions runs through gh", async () => {
    const t = setup(true, [
      { name: "acme.api", link: BUILD },
      { name: "acme.api (Unit tests)", link: `${BUILD}&view=logs&jobId=a1f3c9e2-7b44-5d1e-9c0a-2f6e8b1d4c55` },
      FAILED[0]!,
    ]);
    const http = fakeHttp({ [`GET ${AT}/timeline`]: json(fixture("azure-devops/build-timeline-failed.json")), [`PATCH ${AT}/stages/build`]: status(204) });
    const providers = providerRegistry([
      gitHubCliConnection(t.exec),
      azureDevOpsConnection({ id: "ado", organization: "acme", backend: "api", exec: t.exec, http, tokens: memoryTokens({ ado: "pat" }) }),
    ]);
    expect((await rerunCi({ ...t.deps, providers }, "item-1")).state).toBe("checking");
    expect(http.requests.filter((r) => r.method === "PATCH").map((r) => r.path)).toEqual([`${AT}/stages/build?api-version=7.1`]);
    expect(t.exec.calls.map((c) => c.args.join(" "))).toEqual(["run rerun 7 --failed --repo github.com/acme/widgets"]);
    expect(t.last()).toMatchObject({ type: "ci.started", payload: { reason: "rerun", runs: [BUILD, "7"] } });
  });

  it("names the organization no connection serves", async () => {
    const t = setup(true, [{ name: "acme.api", link: BUILD }]);
    await expect(rerunCi(t.deps, "item-1")).rejects.toEqual(new CiActionError(502, "no connection for the Azure DevOps organization acme"));
  });
});

describe("markCiDone", () => {
  it("moves a red or still checking item to Done", () => {
    for (const red of [true, false]) {
      const t = setup(red);
      expect(markCiDone({ ...t.deps, agentActive: () => false }, "item-1").state).toBe("done");
      expect(t.last()).toMatchObject({ type: "ci.marked_done", actor: "user" });
    }
  });

  it("refuses while the agent runs", () => {
    const t = setup();
    expect(() => markCiDone({ ...t.deps, agentActive: () => true }, "item-1")).toThrow(CiActionError);
  });
});

describe("fixCi", () => {
  it("resumes the agent with the failed checks and their logs", async () => {
    const t = setup();
    const calls: { itemId: string; prompt: string; to: string }[] = [];
    await fixCi({ ...t.deps, resume: async (itemId, how) => calls.push({ itemId, prompt: how.prompt, to: how.transition(t.item(), t.deps.ctx).item.state }) }, "item-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ itemId: "item-1", to: "running" });
    expect(calls[0]!.prompt).toContain("pull request #45");
    expect(calls[0]!.prompt).toContain("expected 1 to be 2");
  });

  it("refuses without a red CI", async () => {
    const t = setup(false);
    await expect(fixCi({ ...t.deps, resume: async () => undefined }, "item-1")).rejects.toMatchObject({ status: 409 });
  });
});
