import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations.js";

export type Db = DatabaseSync;

/** Open (or create) the database file and bring the schema up to date. `:memory:` for tests. */
export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function schemaVersion(db: Db): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

/** Apply every migration above the stored version, each in its own transaction. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number {
  let version = schemaVersion(db);
  if (version > migrations.length) {
    throw new Error(`Database schema version ${version} is newer than this daemon (${migrations.length})`);
  }
  for (; version < migrations.length; version++) {
    const m = migrations[version]!;
    const next = version + 1;
    if (typeof m === "string") {
      transaction(db, () => {
        db.exec(m);
        db.exec(`PRAGMA user_version = ${next}`);
      });
    } else {
      rebuild(db, m.sql, next);
    }
  }
  return version;
}

/** SQLite's table rebuild procedure: foreign keys off, change, check they still hold, commit. */
function rebuild(db: Db, sql: string, next: number): void {
  const fk = (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(db, () => {
      db.exec(sql);
      const broken = db.prepare("PRAGMA foreign_key_check").all();
      if (broken.length > 0) throw new Error(`Migration ${next} broke ${broken.length} foreign key(s)`);
      db.exec(`PRAGMA user_version = ${next}`);
    });
  } finally {
    db.exec(`PRAGMA foreign_keys = ${fk ? "ON" : "OFF"}`);
  }
}

/** Run `fn` inside BEGIN/COMMIT; roll back and rethrow on error. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
