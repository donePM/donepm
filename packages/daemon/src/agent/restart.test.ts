import { start } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { AskStore } from "../asks/store.js";
import { openDb } from "../db/database.js";
import { EventStore } from "../events/store.js";
import { itemWriter } from "../items/commit.js";
import { ItemStore } from "../items/store.js";
import { silentLog } from "../log.js";
import { testCtx } from "../test-support/ctx.js";
import { EXPIRED_REASON, recoverAfterRestart } from "./restart.js";

describe("recoverAfterRestart", () => {
  it("expires pending asks with a reason", () => {
    const db = openDb(":memory:");
    const ctx = testCtx();
    const items = new ItemStore(db);
    const asks = new AskStore(db);
    const writer = itemWriter({ db, items, events: new EventStore(db), onItem: () => {}, onEvent: () => {} });
    items.insert(
      {
        id: "i1", source: "github-issue", externalId: "o/r#1", externalUrl: "https://github.com/o/r/issues/1", title: "T", body: "",
        labels: [], state: "ready", playbook: "implement", priority: 1, stateSince: "2026-10-01T00:00:00.000Z",
        createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
      },
      "github.com/o/r",
    );
    writer.commit(start(items.get("i1")!.item, ctx));
    asks.insert({ id: "a1", itemId: "i1", agentKind: "claude-code", requestId: "r1", toolName: "Bash", input: {}, subject: { kind: "tool", name: "Bash", input: {} }, state: "pending", rules: [] }, ctx.now());

    recoverAfterRestart({ items, asks, writer, ctx, log: silentLog });

    expect(asks.get("a1")).toMatchObject({ state: "expired", outcomeReason: EXPIRED_REASON });
    expect(asks.pending("i1")).toEqual([]);
  });
});
