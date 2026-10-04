import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { ItemStore } from "../items/store.js";
import { TranscriptStore } from "./store.js";

describe("TranscriptStore", () => {
  it("keeps the agent whose protocol a line is in, and none for the daemon's own lines (#136)", () => {
    const db = openDb(":memory:");
    const at = "2026-10-04T00:00:00.000Z";
    new ItemStore(db).insert(
      {
        id: "i", source: "github-issue", externalId: "o/r#1", externalUrl: "https://github.com/o/r/issues/1", title: "T", body: "",
        labels: [], state: "ready", playbook: "implement", priority: 1, stateSince: at, createdAt: at, updatedAt: at,
      },
      "github.com/o/r",
    );
    const store = new TranscriptStore(db);
    const base = { itemId: "i", sessionId: "", at, raw: { x: 1 } };
    store.append({ ...base, id: "a", kind: "system" });
    store.append({ ...base, id: "b", kind: "raw", agentKind: "claude-code" });
    const [setup, line] = store.page("i");
    expect(setup).not.toHaveProperty("agentKind");
    expect(line).toMatchObject({ id: "b", agentKind: "claude-code", raw: { x: 1 } });
  });
});
