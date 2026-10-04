import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Playbook } from "@donepm/core";
import { permissionRules } from "../agent/argv.js";
import { toolNames } from "../bridge/tools.js";
import { readPlaybookDir, repoPlaybookDir, type PlaybookFile, type PlaybookProblem } from "./load.js";

/**
 * A global file named like a playbook donePM ships (`implement.md`, `review.md`): `default` while it
 * still holds the shipped text, `edited` once the user changed it (issue #154).
 */
export type BuiltInState = "default" | "edited";

/** One playbook as Settings > Playbooks lists and shows it (issues #127, #154). */
export interface PlaybookEntry {
  name: string;
  model: string;
  effort?: string;
  permissionMode: Playbook["permissionMode"];
  drafts: Playbook["drafts"];
  readOnly?: boolean;
  match?: Playbook["match"];
  /** The first message the agent gets, placeholders unfilled. */
  body: string;
  /** donePM's MCP tools the agent sees: its drafts' tools and the always-present ones. */
  tools: string[];
  /** Permission rules the agent starts with, the read-only ones included (D42). */
  permissions: { allow: string[]; deny: string[] };
  file: string;
  /** Global, or the repository whose `.donepm/playbooks` holds it. */
  scope: { kind: "global" } | { kind: "repo"; repoId: string; origin: string; path: string };
  /** A repository playbook that replaces the global one of the same name there. */
  overridesGlobal?: boolean;
  builtIn?: BuiltInState;
}

export interface PlaybookList {
  globalDir: string;
  playbooks: PlaybookEntry[];
  problems: PlaybookProblem[];
}

const entry = ({ playbook: p, file }: PlaybookFile, scope: PlaybookEntry["scope"]): PlaybookEntry => ({
  name: p.name,
  model: p.model,
  ...(p.effort ? { effort: p.effort } : {}),
  permissionMode: p.permissionMode,
  drafts: p.drafts,
  ...(p.readOnly ? { readOnly: true } : {}),
  ...(p.match ? { match: p.match } : {}),
  body: p.body,
  tools: toolNames(p.drafts),
  permissions: permissionRules(p.readOnly === true),
  file,
  scope,
});

/** The shipped text of each built-in playbook by file name. A built-in that cannot be read is left out. */
async function builtInTexts(sources: readonly string[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const source of sources) {
    const text = await readFile(source, "utf8").catch(() => undefined);
    if (text !== undefined) texts.set(basename(source), text);
  }
  return texts;
}

/**
 * The global playbooks, then each repository's own, with broken files reported. `builtIns` are the
 * shipped playbook files: a global file of the same name says whether it still matches.
 */
export async function listPlaybooks(
  globalDir: string,
  repos: ReadonlyArray<{ id: string; path: string; originUrl: string }>,
  builtIns: readonly string[] = [],
): Promise<PlaybookList> {
  const global = await readPlaybookDir(globalDir);
  const shipped = await builtInTexts(builtIns);
  const globalNames = new Set(global.files.map((f) => f.playbook.name));
  const playbooks = global.files.map((f) => {
    const e = entry(f, { kind: "global" });
    const text = shipped.get(basename(f.file));
    return text === undefined ? e : { ...e, builtIn: (text === f.text ? "default" : "edited") as BuiltInState };
  });
  const problems = [...global.problems];
  for (const repo of repos) {
    const own = await readPlaybookDir(repoPlaybookDir(repo.path));
    problems.push(...own.problems);
    for (const f of own.files) {
      const e = entry(f, { kind: "repo", repoId: repo.id, origin: repo.originUrl, path: repo.path });
      playbooks.push(globalNames.has(f.playbook.name) ? { ...e, overridesGlobal: true } : e);
    }
  }
  return { globalDir, playbooks, problems };
}
