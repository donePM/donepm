import type { Repo, RepoSetup } from "@donepm/core";
import type { Db } from "../db/database.js";

interface RepoRow {
  id: string;
  path: string;
  origin_url: string;
  default_branch: string;
  setup: string | null;
}

function fromRow(r: RepoRow): Repo {
  const repo: Repo = { id: r.id, path: r.path, originUrl: r.origin_url, defaultBranch: r.default_branch };
  if (r.setup !== null) repo.setup = JSON.parse(r.setup) as RepoSetup;
  return repo;
}

export class RepoStore {
  constructor(private readonly db: Db) {}

  all(): Repo[] {
    const rows = this.db.prepare("SELECT * FROM repos ORDER BY path").all() as unknown as RepoRow[];
    return rows.map(fromRow);
  }

  get(id: string): Repo | undefined {
    const row = this.db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined;
    return row && fromRow(row);
  }

  byPath(path: string): Repo | undefined {
    const row = this.db.prepare("SELECT * FROM repos WHERE path = ?").get(path) as RepoRow | undefined;
    return row && fromRow(row);
  }

  /** First clone (by path) whose normalised origin matches. */
  byOrigin(originUrl: string): Repo | undefined {
    const row = this.db
      .prepare("SELECT * FROM repos WHERE origin_url = ? ORDER BY path LIMIT 1")
      .get(originUrl) as RepoRow | undefined;
    return row && fromRow(row);
  }

  /** Keyed by path, so a repo keeps its id across scans. */
  upsert(repo: Repo, scannedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO repos (id, path, origin_url, default_branch, setup, scanned_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET origin_url = excluded.origin_url,
           default_branch = excluded.default_branch, scanned_at = excluded.scanned_at`,
      )
      .run(repo.id, repo.path, repo.originUrl, repo.defaultBranch, repo.setup ? JSON.stringify(repo.setup) : null, scannedAt);
  }

  /** Remove repos not seen in the latest scan. Items referencing them lose their repo link. */
  removeExcept(paths: readonly string[]): void {
    const keep = new Set(paths);
    const del = this.db.prepare("DELETE FROM repos WHERE id = ?");
    for (const r of this.all()) if (!keep.has(r.path)) del.run(r.id);
  }
}
