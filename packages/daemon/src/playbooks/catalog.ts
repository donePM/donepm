import type { Playbook } from "@donepm/core";
import { loadPlaybooks } from "./load.js";

const GLOBAL = "";

/**
 * The playbooks each repository can load, kept in memory so an item view can say which ones its
 * card offers without reading files (issue #153). `load` reads one repository's set and remembers
 * it; `refresh` reads every set again. `get` answers from memory: a repository not loaded yet gets
 * the global set, and nothing before the first load.
 */
export class PlaybookCatalog {
  private readonly sets = new Map<string, Playbook[]>();

  constructor(private readonly globalDir: string) {}

  get(repoPath?: string): Playbook[] {
    return this.sets.get(repoPath ?? GLOBAL) ?? this.sets.get(GLOBAL) ?? [];
  }

  async load(repoPath?: string): Promise<Playbook[]> {
    const { playbooks } = await loadPlaybooks(this.globalDir, repoPath);
    this.sets.set(repoPath ?? GLOBAL, playbooks);
    return playbooks;
  }

  /** The global set and each repository's, again: files may have changed on disk. */
  async refresh(repoPaths: readonly string[]): Promise<void> {
    const keep = new Set([GLOBAL, ...repoPaths]);
    for (const key of [...this.sets.keys()]) if (!keep.has(key)) this.sets.delete(key);
    await this.load();
    for (const path of repoPaths) await this.load(path);
  }
}
