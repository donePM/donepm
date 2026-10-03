import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePlaybook, type Playbook } from "@donepm/core";

export interface PlaybookProblem {
  file: string;
  error: string;
}

export interface LoadedPlaybooks {
  playbooks: Playbook[];
  problems: PlaybookProblem[];
}

async function readDir(dir: string): Promise<LoadedPlaybooks> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return { playbooks: [], problems: [] };
  }
  const out: LoadedPlaybooks = { playbooks: [], problems: [] };
  for (const name of names) {
    const file = join(dir, name);
    try {
      out.playbooks.push(parsePlaybook(await readFile(file, "utf8")));
    } catch (e) {
      out.problems.push({ file, error: (e as Error).message });
    }
  }
  return out;
}

/**
 * Global playbooks plus the repo's `.donepm/playbooks` (spec 8.1). A repo playbook replaces a
 * global one of the same name. Broken files are reported, not fatal.
 */
export async function loadPlaybooks(globalDir: string, repoPath?: string): Promise<LoadedPlaybooks> {
  const global = await readDir(globalDir);
  const repo = repoPath ? await readDir(join(repoPath, ".donepm", "playbooks")) : { playbooks: [], problems: [] };
  const byName = new Map<string, Playbook>();
  for (const p of [...global.playbooks, ...repo.playbooks]) byName.set(p.name, p);
  return { playbooks: [...byName.values()], problems: [...global.problems, ...repo.problems] };
}

/** Write the built-in `implement.md` into the global folder unless it is already there. */
export async function ensureDefaultPlaybook(globalDir: string, source: string): Promise<void> {
  await mkdir(globalDir, { recursive: true });
  await copyFile(source, join(globalDir, "implement.md"), constants.COPYFILE_EXCL).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e;
  });
}
