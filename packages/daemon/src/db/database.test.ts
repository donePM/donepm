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
    expect(tables(db)).toEqual(["asks", "drafts", "events", "items", "permission_grants", "repos", "tombstones", "transcript"]);
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
    db.exec(`INSERT INTO items VALUES ('i','github-issue','o/r#1','u','github.com/o/r',NULL,'t','b','[]','ready','implement',0,NULL,NULL,NULL,0,'a','a',NULL,NULL,'a',NULL,NULL,NULL,NULL,NULL)`);
    db.exec(`INSERT INTO events (id,item_id,at,actor,type,payload) VALUES ('e','i','a','system','item.collected','{}')`);
    expect(() => db.exec("UPDATE events SET type = 'x'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM events")).toThrow(/append-only/);
  });

  it("lets only the events of an archived item be deleted (D37)", () => {
    const db = openDb(":memory:");
    db.exec(`INSERT INTO items VALUES ('i','github-issue','o/r#1','u','github.com/o/r',NULL,'t','b','[]','done','implement',0,NULL,NULL,NULL,0,'a','a',NULL,NULL,'a','2026-10-01',NULL,NULL,NULL,NULL)`);
    db.exec(`INSERT INTO events (id,item_id,at,actor,type,payload) VALUES ('e','i','a','system','item.collected','{}')`);
    expect(() => db.exec("UPDATE events SET type = 'x'")).toThrow(/append-only/);
    db.exec("DELETE FROM events WHERE item_id = 'i'");
    expect(db.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 0 });
  });

  it("keeps external_id unique among live items only (migration 6)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, MIGRATIONS.slice(0, 4));
    db.exec(`INSERT INTO items VALUES ('old','github-issue','o/r#1','u','github.com/o/r',NULL,'t','b','[]','done','implement',2,NULL,NULL,NULL,1,'a','a',NULL,NULL,'s')`);
    db.exec(`INSERT INTO events (id,item_id,at,actor,type,payload) VALUES ('e','old','a','system','item.collected','{}')`);
    migrate(db);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("SELECT id, closed_upstream, state_since, archived_at FROM items").all()).toEqual([
      { id: "old", closed_upstream: 1, state_since: "s", archived_at: null },
    ]);
    const live = (id: string) =>
      db.exec(`INSERT INTO items VALUES ('${id}','github-issue','o/r#1','u','github.com/o/r',NULL,'t','b','[]','ready','implement',2,NULL,NULL,NULL,0,'a','a',NULL,NULL,'s',NULL,NULL,NULL,NULL,NULL)`);
    expect(() => live("new")).toThrow(/UNIQUE/);
    db.exec("UPDATE items SET archived_at = 'z' WHERE id = 'old'");
    live("new");
    expect(() => live("third")).toThrow(/UNIQUE/);
    expect(() => db.exec(`INSERT INTO events (id,item_id,at,actor,type,payload) VALUES ('x','missing','a','system','t','{}')`)).toThrow(/FOREIGN KEY/);
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
