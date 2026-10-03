import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.js";

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
export function migrate(db: Db, migrations: readonly string[] = MIGRATIONS): number {
  let version = schemaVersion(db);
  if (version > migrations.length) {
    throw new Error(`Database schema version ${version} is newer than this daemon (${migrations.length})`);
  }
  for (; version < migrations.length; version++) {
    transaction(db, () => {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return version;
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
