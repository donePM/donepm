import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations.js";
import { migrate, openDb, schemaVersion, transaction } from "./database.js";

function tables(db: ReturnType<typeof openDb>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

describe("database", () => {
  it("migrates an empty database to the latest version", () => {
    const db = openDb(":memory:");
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(["asks", "drafts", "events", "items", "repos", "transcript"]);
  });

  it("is idempotent", () => {
    const db = openDb(":memory:");
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it("applies only migrations above the stored version, in order", () => {
    const db = openDb(":memory:");
    const extra = [...MIGRATIONS, "CREATE TABLE a (x)", "INSERT INTO a VALUES (1)"];
    expect(migrate(db, extra)).toBe(extra.length);
    expect(db.prepare("SELECT x FROM a").all()).toEqual([{ x: 1 }]);
  });

  it("refuses a schema newer than the daemon", () => {
    const db = openDb(":memory:");
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer/);
  });

  it("rolls back a failed migration", () => {
    const db = openDb(":memory:");
    expect(() => migrate(db, [...MIGRATIONS, "CREATE TABLE b (x); SELECT nope FROM missing"])).toThrow();
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).not.toContain("b");
  });

  it("keeps events append-only", () => {
    const db = openDb(":memory:");
    db.exec(`INSERT INTO items VALUES ('i','github-issue','o/r#1','u','github.com/o/r',NULL,'t','b','[]','ready','implement',0,NULL,NULL,NULL,0,'a','a',NULL,NULL,'a')`);
    db.exec(`INSERT INTO events (id,item_id,at,actor,type,payload) VALUES ('e','i','a','system','item.collected','{}')`);
    expect(() => db.exec("UPDATE events SET type = 'x'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM events")).toThrow(/append-only/);
  });

  it("backfills the sort keys from the events (migration 3)", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, MIGRATIONS.slice(0, 2));
    const add = (id: string, state: string) =>
      db.exec(`INSERT INTO items VALUES ('${id}','github-issue','o/r#${id}','u','github.com/o/r',NULL,'t','b','[]','${state}','implement',7,NULL,NULL,NULL,0,'t0','t9')`);
    const event = (item: string, at: string, type: string) =>
      db.exec(`INSERT INTO events (id,item_id,at,actor,type,payload) VALUES ('${item}-${at}','${item}','${at}','system','${type}','{}')`);
    add("ready", "ready");
    add("run", "running");
    event("run", "t1", "agent.started");
    event("run", "t2", "permission.asked");
    event("run", "t3", "permission.answered");
    add("wait", "needs_you");
    event("wait", "t1", "agent.started");
    event("wait", "t2", "agent.turn_ended");
    event("wait", "t3", "draft.created");
    add("done", "done");
    event("done", "t1", "agent.started");
    event("done", "t4", "draft.executed");
    event("done", "t5", "worktree.removed");
    add("bare", "done");
    migrate(db);
    const rows = db.prepare("SELECT id, priority, started_at, state_since FROM items ORDER BY id").all();
    expect(rows).toEqual([
      { id: "bare", priority: 2, started_at: null, state_since: "t9" },
      { id: "done", priority: 2, started_at: "t1", state_since: "t4" },
      { id: "ready", priority: 2, started_at: null, state_since: "t0" },
      { id: "run", priority: 2, started_at: "t1", state_since: "t3" },
      { id: "wait", priority: 2, started_at: "t1", state_since: "t2" },
    ]);
  });

  it("transaction rolls back on error", () => {
    const db = openDb(":memory:");
    expect(() =>
      transaction(db, () => {
        db.exec(`INSERT INTO repos VALUES ('r','/p','github.com/o/r','main',NULL,'a')`);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.prepare("SELECT count(*) AS n FROM repos").get()).toEqual({ n: 0 });
  });
});
