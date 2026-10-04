import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { normalizeOriginUrl, parseCloneOrigin, type CloneOrigin, type Ctx, type Repo } from "@donepm/core";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import { readDefaultBranch, readOrigin } from "./git.js";
import type { RepoStore } from "./store.js";

/** Hosts whose clone a provider adapter can make; `gh` for GitHub (issue #37). */
const CLONE_HOSTS = new Set(["github.com"]);

/** A clone can take minutes. */
const CLONE_TIMEOUT_MS = 30 * 60_000;

/** Lines of `gh repo clone` stderr kept for the user. */
const STDERR_TAIL_LINES = 20;

export class CloneError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** `<root>/<owner>/<repo>`, where a clone of `origin` lands. */
export function cloneTarget(root: string, origin: CloneOrigin): string {
  return join(root, origin.owner, origin.repo);
}

/** The origin parsed, when donePM can clone it. */
export function cloneableOrigin(origin: string): CloneOrigin | undefined {
  const parsed = parseCloneOrigin(origin);
  return parsed && CLONE_HOSTS.has(parsed.host) ? parsed : undefined;
}

/** The directory holds a `.git` directory or file of its own. */
export async function hasGitDir(path: string): Promise<boolean> {
  return stat(join(path, ".git")).then(
    () => true,
    () => false,
  );
}

/**
 * What is at the target: nothing (or an empty folder) to clone into, or a clone of `origin`
 * already. Anything else throws a 409 CloneError; nothing there is ever touched.
 */
export async function inspectTarget(exec: Exec, target: string, origin: string): Promise<"empty" | "cloned"> {
  const info = await stat(target).catch(() => undefined);
  if (!info) return "empty";
  if (!info.isDirectory()) throw new CloneError(`${target} exists and is not a folder`, 409);
  if (await hasGitDir(target)) {
    const url = await readOrigin(exec, target);
    const found = url && normalizeOriginUrl(url);
    if (found === origin) return "cloned";
    throw new CloneError(found ? `${target} is a clone of ${found}` : `${target} is a git repository without an origin`, 409);
  }
  if ((await readdir(target)).length > 0) throw new CloneError(`${target} is a folder with files in it, not a clone`, 409);
  return "empty";
}

export type ClonePush = "repo.cloning" | "repo.cloned" | "repo.clone_failed";

export interface ClonerDeps {
  exec: Exec;
  repos: RepoStore;
  ctx: Ctx;
  log: Log;
  /** `repoRoot`, expanded. */
  root: () => string;
  push: (type: ClonePush, payload: unknown) => void;
  /** A clone started, finished or failed: relink items and show the new state. */
  changed: (origin: string) => void;
}

/** The Clone button's state for one origin. */
export interface CloneState {
  origin: string;
  target: string;
  cloning?: true;
  /** The last attempt failed; cleared by the next one. */
  error?: string;
}

/**
 * Clones a repository without a local clone into `<repoRoot>/<owner>/<repo>` with `gh repo clone`
 * and registers it directly, so the scan rules (hidden folders, `vendor`) do not matter. The click
 * is the user's decision and nothing is written to GitHub, so no draft (issue #37).
 */
export class RepoCloner {
  private readonly running = new Set<string>();
  private readonly failures = new Map<string, string>();

  constructor(private readonly deps: ClonerDeps) {}

  /** Undefined when the origin cannot be cloned from the board. */
  state(origin: string): CloneState | undefined {
    const parsed = cloneableOrigin(origin);
    if (!parsed) return undefined;
    const error = this.failures.get(origin);
    return {
      origin,
      target: cloneTarget(this.deps.root(), parsed),
      ...(this.running.has(origin) ? { cloning: true as const } : {}),
      ...(error ? { error } : {}),
    };
  }

  /**
   * Throws CloneError. `cloned`: a clone of the origin was at the target already and is registered
   * now. `started`: `gh` runs; `done` settles once it registered the clone or failed.
   */
  async clone(origin: string): Promise<{ target: string } & ({ result: "cloned" } | { result: "started"; done: Promise<void> })> {
    const parsed = cloneableOrigin(origin);
    if (!parsed) throw new CloneError(`${origin} cannot be cloned from donePM`, 400);
    if (this.running.has(origin)) throw new CloneError(`${origin} is being cloned`, 409);
    const known = this.deps.repos.byOrigin(origin);
    if (known) throw new CloneError(`${origin} has a local clone at ${known.path}`, 409);

    const target = cloneTarget(this.deps.root(), parsed);
    this.running.add(origin);
    try {
      if ((await inspectTarget(this.deps.exec, target, origin)) === "cloned") {
        await this.register(origin, target);
        this.running.delete(origin);
        this.failures.delete(origin);
        this.deps.push("repo.cloned", { origin, path: target });
        this.deps.changed(origin);
        return { target, result: "cloned" };
      }
    } catch (e) {
      this.running.delete(origin);
      throw e;
    }

    this.failures.delete(origin);
    this.deps.push("repo.cloning", { origin, path: target });
    this.deps.changed(origin);
    const done = this.run(origin, parsed, target);
    return { target, result: "started", done };
  }

  private async run(origin: string, parsed: CloneOrigin, target: string): Promise<void> {
    const { exec, log } = this.deps;
    try {
      const r = await exec("gh", ["repo", "clone", `${parsed.owner}/${parsed.repo}`, target], { timeoutMs: CLONE_TIMEOUT_MS });
      if (r.code !== 0) throw new CloneError(tail(r.stderr) || `gh repo clone exited with ${r.code}`, 502);
      await this.register(origin, target);
      log.info({ origin, path: target }, "repository cloned");
      this.deps.push("repo.cloned", { origin, path: target });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log.warn({ origin, path: target, error }, "clone failed");
      this.failures.set(origin, error);
      this.deps.push("repo.clone_failed", { origin, path: target, error });
    } finally {
      this.running.delete(origin);
      this.deps.changed(origin);
    }
  }

  /** Stored only once the clone is there with the expected origin; a failure leaves no repo behind. */
  private async register(origin: string, path: string): Promise<Repo> {
    const { exec, repos, ctx } = this.deps;
    const url = await readOrigin(exec, path);
    if (!url || normalizeOriginUrl(url) !== origin) throw new CloneError(`${path} has no origin ${origin} after cloning`, 502);
    const { branch } = await readDefaultBranch(exec, path);
    const repo: Repo = { id: repos.byPath(path)?.id ?? ctx.newId(), path, originUrl: origin, defaultBranch: branch };
    repos.upsert(repo, ctx.now());
    return repo;
  }
}

function tail(stderr: string): string {
  return stderr.trimEnd().split("\n").slice(-STDERR_TAIL_LINES).join("\n").trim();
}
