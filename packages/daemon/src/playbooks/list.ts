import type { Playbook } from "@donepm/core";
import { readPlaybookDir, repoPlaybookDir, type PlaybookProblem } from "./load.js";

/** One playbook as Settings > Playbooks lists it (issue #127). */
export interface PlaybookEntry {
  name: string;
  model: string;
  effort?: string;
  permissionMode: Playbook["permissionMode"];
  drafts: Playbook["drafts"];
  readOnly?: boolean;
  file: string;
  /** Global, or the repository whose `.donepm/playbooks` holds it. */
  scope: { kind: "global" } | { kind: "repo"; repoId: string; origin: string; path: string };
  /** A repository playbook that replaces the global one of the same name there. */
  overridesGlobal?: boolean;
}

export interface PlaybookList {
  globalDir: string;
  playbooks: PlaybookEntry[];
  problems: PlaybookProblem[];
}

const entry = (p: Playbook, file: string, scope: PlaybookEntry["scope"]): PlaybookEntry => ({
  name: p.name,
  model: p.model,
  ...(p.effort ? { effort: p.effort } : {}),
  permissionMode: p.permissionMode,
  drafts: p.drafts,
  ...(p.readOnly ? { readOnly: true } : {}),
  file,
  scope,
});

/** The global playbooks, then each repository's own, with broken files reported. */
export async function listPlaybooks(
  globalDir: string,
  repos: ReadonlyArray<{ id: string; path: string; originUrl: string }>,
): Promise<PlaybookList> {
  const global = await readPlaybookDir(globalDir);
  const globalNames = new Set(global.files.map((f) => f.playbook.name));
  const playbooks = global.files.map((f) => entry(f.playbook, f.file, { kind: "global" }));
  const problems = [...global.problems];
  for (const repo of repos) {
    const own = await readPlaybookDir(repoPlaybookDir(repo.path));
    problems.push(...own.problems);
    for (const f of own.files) {
      const e = entry(f.playbook, f.file, { kind: "repo", repoId: repo.id, origin: repo.originUrl, path: repo.path });
      playbooks.push(globalNames.has(f.playbook.name) ? { ...e, overridesGlobal: true } : e);
    }
  }
  return { globalDir, playbooks, problems };
}
