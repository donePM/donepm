import { start, type WorkItem } from "@donepm/core";
import { openDb } from "../db/database.js";
import type { DraftDeps } from "../drafts/actions.js";
import { DraftStore } from "../drafts/store.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { RepoStore } from "../repos/store.js";
import { testCtx } from "./ctx.js";

/** In-memory stores with one repo and one running item (`item-1`), for draft and bridge tests; `over` and `origin` change them. */
export function draftStores(over: Partial<WorkItem> = {}, origin = "github.com/o/r") {
  const db = openDb(":memory:");
  const ctx = testCtx();
  const items = new ItemStore(db);
  const events = new EventStore(db);
  const repos = new RepoStore(db);
  const drafts = new DraftStore(db);
  const writer = itemWriter({ db, items, events, onItem: () => {}, onEvent: () => {} });
  repos.upsert({ id: "repo-1", path: "/code/o/r", originUrl: origin, defaultBranch: "main" }, ctx.now());
  const item: WorkItem = {
    id: "item-1", source: "github-issue", externalId: "o/r#1", externalUrl: "https://github.com/o/r/issues/1",
    repoId: "repo-1", title: "Fix it", body: "", labels: [], state: "ready", playbook: "implement", priority: 1,
    stateSince: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    branch: "dp/1-fix-it", worktreePath: "/wt/1", ...over,
  };
  items.insert(item, origin);
  writer.commit(start(item, ctx));
  const deps: DraftDeps = { items, repos, drafts, events, writer, ctx };
  const state = (id = "item-1") => items.get(id)!.item.state;
  const types = (id = "item-1") => events.forItem(id).map((e) => e.type);
  return { db, deps, items, events, drafts, state, types };
}
