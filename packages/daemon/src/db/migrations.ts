/**
 * Ordered schema migrations. Index + 1 is the version stored in `PRAGMA user_version`.
 * Never edit a released migration; append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE repos (
    id             TEXT PRIMARY KEY,
    path           TEXT NOT NULL UNIQUE,
    origin_url     TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    setup          TEXT,
    scanned_at     TEXT NOT NULL
  );
  CREATE INDEX repos_origin_url ON repos (origin_url);

  CREATE TABLE items (
    id               TEXT PRIMARY KEY,
    source           TEXT NOT NULL,
    external_id      TEXT NOT NULL UNIQUE,
    external_url     TEXT NOT NULL,
    origin_url       TEXT NOT NULL,
    repo_id          TEXT REFERENCES repos (id) ON DELETE SET NULL,
    title            TEXT NOT NULL,
    body             TEXT NOT NULL,
    labels           TEXT NOT NULL,
    state            TEXT NOT NULL,
    playbook         TEXT NOT NULL,
    priority         INTEGER NOT NULL,
    worktree_path    TEXT,
    branch           TEXT,
    agent_session_id TEXT,
    closed_upstream  INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE events (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    id      TEXT NOT NULL UNIQUE,
    item_id TEXT NOT NULL REFERENCES items (id),
    at      TEXT NOT NULL,
    actor   TEXT NOT NULL,
    type    TEXT NOT NULL,
    payload TEXT NOT NULL,
    ref_id  TEXT
  );
  CREATE INDEX events_item ON events (item_id, seq);
  CREATE TRIGGER events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

  CREATE TABLE drafts (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL REFERENCES items (id),
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    state      TEXT NOT NULL,
    user_edits TEXT,
    result     TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX drafts_item ON drafts (item_id);

  CREATE TABLE asks (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL REFERENCES items (id),
    request_id TEXT NOT NULL,
    tool_name  TEXT NOT NULL,
    input      TEXT NOT NULL,
    state      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX asks_item ON asks (item_id);

  CREATE TABLE transcript (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    id         TEXT NOT NULL UNIQUE,
    item_id    TEXT NOT NULL REFERENCES items (id),
    session_id TEXT NOT NULL,
    at         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    raw        TEXT NOT NULL
  );
  CREATE INDEX transcript_item ON transcript (item_id, seq);
  `,
];
