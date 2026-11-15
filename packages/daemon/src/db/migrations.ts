/**
 * A migration that rebuilds a table other tables reference. It runs with foreign keys off (they
 * cannot be switched inside a transaction) and checks them before it commits.
 */
export interface RebuildMigration {
  sql: string;
  foreignKeysOff: true;
}

export type Migration = string | RebuildMigration;

/**
 * Ordered schema migrations. Index + 1 is the version stored in `PRAGMA user_version`.
 * Never edit a released migration; append a new one.
 */
export const MIGRATIONS: readonly Migration[] = [
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
  // Rules the CLI suggested for an ask that we may grant "for this run" (already filtered).
  `ALTER TABLE asks ADD COLUMN rules TEXT NOT NULL DEFAULT '[]';`,
  // Sort keys of the board columns (issue #64). `priority` becomes the label tier; the next poll
  // recomputes it and fills in issue_created_at. started_at and state_since come from the events.
  `
  ALTER TABLE items ADD COLUMN issue_created_at TEXT;
  ALTER TABLE items ADD COLUMN started_at TEXT;
  ALTER TABLE items ADD COLUMN state_since TEXT NOT NULL DEFAULT '';
  UPDATE items SET priority = 2;
  UPDATE items SET started_at = (
    SELECT min(at) FROM events e WHERE e.item_id = items.id AND e.type IN ('agent.started', 'agent.resumed')
  );
  UPDATE items SET state_since = created_at WHERE state = 'ready';
  UPDATE items SET state_since = coalesce((
    SELECT min(at) FROM events e WHERE e.item_id = items.id
      AND e.type IN ('agent.started', 'agent.resumed', 'agent.turn_started', 'permission.answered', 'draft.rejected')
      AND e.seq > coalesce((SELECT max(seq) FROM events x WHERE x.item_id = items.id
        AND x.type IN ('permission.asked', 'agent.interrupted', 'agent.turn_ended', 'draft.created', 'agent.failed')), 0)
  ), updated_at) WHERE state = 'running';
  UPDATE items SET state_since = coalesce((
    SELECT min(at) FROM events e WHERE e.item_id = items.id
      AND e.type IN ('permission.asked', 'agent.interrupted', 'agent.turn_ended', 'draft.created')
      AND e.seq > coalesce((SELECT max(seq) FROM events x WHERE x.item_id = items.id
        AND x.type IN ('agent.started', 'agent.resumed', 'agent.turn_started', 'permission.answered', 'draft.rejected')), 0)
  ), updated_at) WHERE state = 'needs_you';
  UPDATE items SET state_since = coalesce((
    SELECT max(at) FROM events e WHERE e.item_id = items.id AND e.type = 'agent.failed'
  ), updated_at) WHERE state = 'failed';
  UPDATE items SET state_since = coalesce((
    SELECT min(at) FROM events e WHERE e.item_id = items.id
      AND e.type IN ('draft.executed', 'item.closed_upstream', 'item.dismissed')
  ), updated_at) WHERE state = 'done';
  `,
  // Why the CLI asked (`decision_reason`), shown above the ask (issue #67).
  `ALTER TABLE asks ADD COLUMN reason TEXT;`,
  // Why an ask ended without the user's answer (daemon stop, restart), shown on the ask row (issue #73).
  `ALTER TABLE asks ADD COLUMN outcome_reason TEXT;`,
  // Archive and retention (issue #63, D37). items gets archived_at; external_id is unique only among
  // live items, so a reopened issue whose old item is archived is collected as a new item. Events of
  // an archived item may be deleted, by the retention purge only. Tombstones keep a purged issue
  // from being imported again while it stays closed.
  {
    foreignKeysOff: true,
    sql: `
    CREATE TABLE items_new (
      id               TEXT PRIMARY KEY,
      source           TEXT NOT NULL,
      external_id      TEXT NOT NULL,
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
      updated_at       TEXT NOT NULL,
      issue_created_at TEXT,
      started_at       TEXT,
      state_since      TEXT NOT NULL DEFAULT '',
      archived_at      TEXT
    );
    INSERT INTO items_new (id, source, external_id, external_url, origin_url, repo_id, title, body, labels, state,
      playbook, priority, worktree_path, branch, agent_session_id, closed_upstream, created_at, updated_at,
      issue_created_at, started_at, state_since)
    SELECT id, source, external_id, external_url, origin_url, repo_id, title, body, labels, state,
      playbook, priority, worktree_path, branch, agent_session_id, closed_upstream, created_at, updated_at,
      issue_created_at, started_at, state_since
    FROM items;
    DROP TABLE items;
    ALTER TABLE items_new RENAME TO items;
    CREATE UNIQUE INDEX items_external_live ON items (external_id) WHERE archived_at IS NULL;
    CREATE INDEX items_external ON items (external_id);

    DROP TRIGGER events_no_delete;
    CREATE TRIGGER events_no_delete BEFORE DELETE ON events
      WHEN (SELECT archived_at FROM items WHERE id = OLD.item_id) IS NULL
      BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

    CREATE TABLE tombstones (
      external_id TEXT PRIMARY KEY,
      source      TEXT NOT NULL,
      origin_url  TEXT NOT NULL,
      closed      INTEGER NOT NULL DEFAULT 0,
      deleted_at  TEXT NOT NULL
    );
    `,
  },
  // "Always allow" per repository (issue #72, D38). `repo` is the normalised origin, so a rescan or a
  // second clone keeps the grants. A removal sets revoked_at; the row stays for the events. ask_id and
  // item_id carry no foreign key: a grant outlives the retention purge of the item it was granted on,
  // so `call` keeps the words of that call.
  `
  CREATE TABLE permission_grants (
    id           TEXT PRIMARY KEY,
    repo         TEXT NOT NULL,
    tool_name    TEXT NOT NULL,
    rule_content TEXT,
    created_at   TEXT NOT NULL,
    ask_id       TEXT NOT NULL,
    item_id      TEXT NOT NULL,
    call         TEXT NOT NULL DEFAULT '',
    use_count    INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    revoked_at   TEXT
  );
  CREATE INDEX permission_grants_repo ON permission_grants (repo) WHERE revoked_at IS NULL;
  `,
  // A reviewed pull request's base branch (issue #48, D41): its diff and prompt compare against it
  // instead of the repository's default branch.
  `ALTER TABLE items ADD COLUMN base_branch TEXT;`,
  // Who opened a pull request item (D47): Dependabot, a colleague.
  `ALTER TABLE items ADD COLUMN author TEXT;`,
  // Where someone else's pull request stands, as JSON (D47): mergeable, base, reviews, checks.
  `ALTER TABLE items ADD COLUMN pr_status TEXT;`,
  // The user's per-item auto-merge choice for someone else's pull request (D47); NULL: the repo's default.
  `ALTER TABLE items ADD COLUMN auto_merge INTEGER;`,
  // Auto-merge held after a refusal that passes (issue #146, D47), as JSON `{ head, mergeState }`.
  `ALTER TABLE items ADD COLUMN auto_merge_held TEXT;`,
  // The coding agent an item runs with (issue #136, D49), fixed once it has a session. NULL: not started
  // yet, or started before there was a choice, which was Claude Code.
  `ALTER TABLE items ADD COLUMN agent_kind TEXT;`,
  // The agent that asked and what it asked about, in neutral words (issue #136). NULL: asked before,
  // by Claude Code; the store derives the subject from the tool name and input.
  `
  ALTER TABLE asks ADD COLUMN agent_kind TEXT;
  ALTER TABLE asks ADD COLUMN subject TEXT;
  `,
  // Whose protocol a transcript line is in (issue #136). NULL: the daemon's own line, or Claude Code's
  // from before agents had a kind.
  `ALTER TABLE transcript ADD COLUMN agent_kind TEXT;`,
  // A ticket's repositories as a JSON array (issue #139); its origin_url is the one chosen, '' until then.
  // NULL: an item of one repository, a GitHub issue or pull request.
  `ALTER TABLE items ADD COLUMN repo_candidates TEXT;`,
];
