import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parsePlaybook, type Playbook } from "@donepm/core";

export interface PlaybookProblem {
  file: string;
  error: string;
}

export interface LoadedPlaybooks {
  playbooks: Playbook[];
  problems: PlaybookProblem[];
}

/** A parsed playbook and the file it came from. */
export interface PlaybookFile {
  playbook: Playbook;
  file: string;
}

/** Every `.md` in `dir`, parsed, sorted by file name. A missing folder is empty. */
export async function readPlaybookDir(dir: string): Promise<{ files: PlaybookFile[]; problems: PlaybookProblem[] }> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return { files: [], problems: [] };
  }
  const out: { files: PlaybookFile[]; problems: PlaybookProblem[] } = { files: [], problems: [] };
  for (const name of names) {
    const file = join(dir, name);
    try {
      out.files.push({ playbook: parsePlaybook(await readFile(file, "utf8")), file });
    } catch (e) {
      out.problems.push({ file, error: (e as Error).message });
    }
  }
  return out;
}

/** A repository's own playbooks (spec 8.1). */
export const repoPlaybookDir = (repoPath: string): string => join(repoPath, ".donepm", "playbooks");

async function readDir(dir: string): Promise<LoadedPlaybooks> {
  const { files, problems } = await readPlaybookDir(dir);
  return { playbooks: files.map((f) => f.playbook), problems };
}

/**
 * Global playbooks plus the repo's `.donepm/playbooks` (spec 8.1). A repo playbook replaces a
 * global one of the same name. Broken files are reported, not fatal.
 */
export async function loadPlaybooks(globalDir: string, repoPath?: string): Promise<LoadedPlaybooks> {
  const global = await readDir(globalDir);
  const repo = repoPath ? await readDir(repoPlaybookDir(repoPath)) : { playbooks: [], problems: [] };
  const byName = new Map<string, Playbook>();
  for (const p of [...global.playbooks, ...repo.playbooks]) byName.set(p.name, p);
  return { playbooks: [...byName.values()], problems: [...global.problems, ...repo.problems] };
}

/**
 * Write each built-in playbook (`implement.md`, `review.md`) into the global folder under its own
 * file name, unless a file of that name is already there: the user's copy always wins.
 */
export async function ensureDefaultPlaybooks(globalDir: string, sources: string[]): Promise<void> {
  await mkdir(globalDir, { recursive: true });
  for (const source of sources) {
    await copyFile(source, join(globalDir, basename(source)), constants.COPYFILE_EXCL).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
  }
}
