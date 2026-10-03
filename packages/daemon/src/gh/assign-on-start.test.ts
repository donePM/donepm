import type { WorkItem } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import type { Exec } from "../process/exec.js";
import { testCtx } from "../test-support/ctx.js";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { assignOnStart } from "./assign-on-start.js";

const ITEM: WorkItem = {
  id: "item-1", source: "github-issue", externalId: "Acme/API#12", externalUrl: "https://github.com/Acme/API/issues/12",
  title: "T", body: "", labels: [], state: "running", playbook: "implement", priority: 0,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};

function setup(exec: Exec, sources: Config["sources"]) {
  const db = openDb(":memory:");
  const items = new ItemStore(db);
  const events = new EventStore(db);
  items.insert(ITEM, "github.com/acme/api");
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  return { deps: { items, writer, exec, ctx: testCtx(), log: silentLog, sources: () => sources }, events };
}

describe("assignOnStart", () => {
  it("does nothing unless the repository opted in", async () => {
    const exec = fakeExec({});
    const { deps, events } = setup(exec, { "github.com/acme/api": { query: "x", assignOnStart: false } });
    await assignOnStart(deps, "item-1", "github.com/acme/api");
    expect(exec.calls).toEqual([]);
    expect(events.forItem("item-1")).toEqual([]);
  });

  it("assigns the issue to the gh user and records it", async () => {
    const exec = fakeExec({ "gh issue edit": ok("") });
    const { deps, events } = setup(exec, { "github.com/acme/api": { assignOnStart: true } });
    await assignOnStart(deps, "item-1", "github.com/acme/api");
    expect(exec.calls[0]!.args).toEqual(["issue", "edit", "12", "--repo", "Acme/API", "--add-assignee", "@me"]);
    expect(events.forItem("item-1")).toMatchObject([{ type: "item.assigned", actor: "system" }]);
    expect(deps.items.get("item-1")!.item.state).toBe("running");
  });

  it("records a failure and leaves the item alone", async () => {
    const { deps, events } = setup(fakeExec({ "gh issue edit": fail("HTTP 403") }), { "github.com/acme/api": { assignOnStart: true } });
    await assignOnStart(deps, "item-1", "github.com/acme/api");
    expect(events.forItem("item-1")).toMatchObject([{ type: "item.assign_failed", payload: { reason: "HTTP 403" } }]);
    expect(deps.items.get("item-1")!.item.state).toBe("running");
  });
});
