import { execFileSync } from "node:child_process";
import { gitHubCliConnection, githubProviders } from "../gh/adapter.js";
import { azureDevOpsConnection } from "../azure/connection.js";
import { providerRegistry } from "../providers/registry.js";
import { fakeHttp } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { silentLog } from "../log.js";
import { exec as realExec, type Exec } from "../process/exec.js";
import { testCtx } from "../test-support/ctx.js";
import { cloneWithOrigin, git } from "../test-support/git-repo.js";
import { CloneError, inspectTarget, RepoCloner, type ClonePush } from "./clone.js";
import { discoverRepos } from "./discover.js";
import { RepoStore } from "./store.js";

const ORIGIN = "github.com/acme/widgets";

/**
 * `gh repo clone` is played by `git clone` from a local bare repository, then origin is pointed
 * at github.com the way gh leaves it. Real git, no network.
 */
function ghFrom(bare: string, calls: string[][] = []): Exec {
  return async (cmd, args, opts) => {
    if (cmd !== "gh") return realExec(cmd, args, opts);
    calls.push(args);
    const [, , slug, target] = args as [string, string, string, string];
    const r = await realExec("git", ["clone", "-q", bare, target]);
    if (r.code !== 0) return r;
    return realExec("git", ["-C", target, "remote", "set-url", "origin", `git@github.com:${slug}.git`]);
  };
}

const ghFails: Exec = async (cmd, args, opts) =>
  cmd === "gh" ? { code: 1, stdout: "", stderr: "Cloning into 'x'...\nGraphQL: Could not resolve to a Repository with the name 'acme/widgets'.\n" } : realExec(cmd, args, opts);

async function setup(exec: Exec, root?: string) {
  const r = root ?? (await mkdtemp(join(tmpdir(), "donepm-clone-")));
  const repos = new RepoStore(openDb(":memory:"));
  const pushes: [ClonePush, any][] = [];
  const changed: string[] = [];
  const cloner = new RepoCloner({
    exec, providers: githubProviders(exec), repos, ctx: testCtx(), log: silentLog,
    root: () => r,
    push: (type, payload) => pushes.push([type, payload]),
    changed: (o) => changed.push(o),
  });
  return { root: r, repos, cloner, pushes, changed };
}

async function bareOrigin(): Promise<string> {
  return (await cloneWithOrigin()).origin;
}

describe("RepoCloner", () => {
  it("clones into <root>/<owner>/<repo>, then registers the clone", async () => {
    const calls: string[][] = [];
    const { root, repos, cloner, pushes, changed } = await setup(ghFrom(await bareOrigin(), calls));
    const target = join(root, "acme", "widgets");

    expect(cloner.state(ORIGIN)).toEqual({ origin: ORIGIN, target });
    const r = await cloner.clone(ORIGIN);
    expect(r).toMatchObject({ target, result: "started" });
    expect(cloner.state(ORIGIN)).toEqual({ origin: ORIGIN, target, cloning: true });
    await expect(cloner.clone(ORIGIN)).rejects.toMatchObject({ status: 409 });
    if (r.result === "started") await r.done;

    expect(calls).toEqual([["repo", "clone", "acme/widgets", target]]);
    expect(repos.all()).toEqual([{ id: "id-1", path: target, originUrl: ORIGIN, defaultBranch: "main" }]);
    expect(cloner.state(ORIGIN)).toEqual({ origin: ORIGIN, target });
    expect(pushes).toEqual([
      ["repo.cloning", { origin: ORIGIN, path: target }],
      ["repo.cloned", { origin: ORIGIN, path: target }],
    ]);
    expect(changed).toEqual([ORIGIN, ORIGIN]);
  });

  it("registers a clone that is at the target already, without running gh", async () => {
    const parent = await mkdtemp(join(tmpdir(), "donepm-clone-"));
    const { clone } = await cloneWithOrigin({}, parent);
    git(clone, "remote", "set-url", "origin", "https://github.com/acme/widgets");
    const calls: string[][] = [];
    const { repos, cloner, pushes } = await setup(ghFrom("/nowhere", calls), parent);

    expect(await cloner.clone(ORIGIN)).toEqual({ target: clone, result: "cloned" });
    expect(calls).toEqual([]);
    expect(repos.byOrigin(ORIGIN)?.path).toBe(clone);
    expect(pushes.map(([t]) => t)).toEqual(["repo.cloned"]);
  });

  it("reports a failed clone with the stderr tail and registers nothing", async () => {
    const { root, repos, cloner, pushes } = await setup(ghFails);
    const r = await cloner.clone(ORIGIN);
    if (r.result === "started") await r.done;

    const error = "Cloning into 'x'...\nGraphQL: Could not resolve to a Repository with the name 'acme/widgets'.";
    expect(repos.all()).toEqual([]);
    expect(cloner.state(ORIGIN)).toEqual({ origin: ORIGIN, target: join(root, "acme", "widgets"), error });
    expect(pushes.at(-1)).toEqual(["repo.clone_failed", { origin: ORIGIN, path: join(root, "acme", "widgets"), error }]);
  });

  it("clears the last error when the user tries again", async () => {
    let release = () => {};
    let attempts = 0;
    const exec: Exec = async (cmd, args, opts) => {
      if (cmd !== "gh") return realExec(cmd, args, opts);
      if (++attempts > 1) await new Promise<void>((resolve) => (release = resolve));
      return ghFails(cmd, args, opts);
    };
    const { cloner } = await setup(exec);
    const first = await cloner.clone(ORIGIN);
    if (first.result === "started") await first.done;
    expect(cloner.state(ORIGIN)?.error).toBeDefined();

    const second = await cloner.clone(ORIGIN);
    expect(cloner.state(ORIGIN)).not.toHaveProperty("error");
    expect(cloner.state(ORIGIN)).toMatchObject({ cloning: true });
    release();
    if (second.result === "started") await second.done;
  });

  it("registers a clone under an owner the scan skips, and a rescan keeps it", async () => {
    const { root, repos, cloner } = await setup(ghFrom(await bareOrigin()));
    for (const origin of ["github.com/vendor/lib", "github.com/acme/.github"]) {
      const r = await cloner.clone(origin);
      if (r.result === "started") await r.done;
    }
    const paths = [join(root, "acme", ".github"), join(root, "vendor", "lib")];
    expect(repos.all().map((r) => r.path)).toEqual(paths);

    const ids = repos.all().map((r) => r.id);
    await discoverRepos({ root, exec: realExec, repos, ctx: testCtx(), log: silentLog });
    expect(repos.all().map((r) => [r.path, r.id])).toEqual(paths.map((p, i) => [p, ids[i]]));

    // Under another root they are gone like every other clone.
    await discoverRepos({ root: join(root, "elsewhere"), exec: realExec, repos, ctx: testCtx(), log: silentLog });
    expect(repos.all()).toEqual([]);
  });

  it("refuses origins it cannot clone", async () => {
    const { cloner } = await setup(ghFails);
    expect(cloner.state("gitlab.com/acme/widgets")).toBeUndefined();
    await expect(cloner.clone("gitlab.com/acme/widgets")).rejects.toMatchObject({ status: 400 });
    await expect(cloner.clone("github.com/../etc")).rejects.toMatchObject({ status: 400 });
  });

  it("clones from every host a connection serves, and only from those", async () => {
    const repos = new RepoStore(openDb(":memory:"));
    const ado = azureDevOpsConnection({ id: "ado", organization: "acme", backend: "cli", exec: ghFails, http: fakeHttp({}), tokens: memoryTokens() });
    const providers = providerRegistry([gitHubCliConnection(ghFails), gitHubCliConnection(ghFails, "github.acme.com", "acme"), ado]);
    const cloner = new RepoCloner({ exec: ghFails, providers, repos, ctx: testCtx(), log: silentLog, root: () => "/r", push: () => {}, changed: () => {} });
    expect(cloner.state("github.com/acme/widgets")).toMatchObject({ target: "/r/acme/widgets" });
    expect(cloner.state("github.acme.com/team/api")).toMatchObject({ target: "/r/github.acme.com/team/api" });
    expect(cloner.state("dev.azure.com/acme/my project/legacy")).toMatchObject({ target: "/r/dev.azure.com/acme/my project/legacy" });
    expect(cloner.state("dev.azure.com/contoso/web/site")).toBeUndefined();
    expect(cloner.state("gitlab.com/acme/widgets")).toBeUndefined();
  });

  it("refuses an origin that has a clone already", async () => {
    const { repos, cloner } = await setup(ghFails);
    repos.upsert({ id: "r", path: "/x/widgets", originUrl: ORIGIN, defaultBranch: "main" }, "t");
    await expect(cloner.clone(ORIGIN)).rejects.toThrow("has a local clone at /x/widgets");
  });

  it("never touches an occupied target and runs no gh", async () => {
    const calls: string[][] = [];
    const { root, repos, cloner, pushes } = await setup(ghFrom("/nowhere", calls));
    const target = join(root, "acme", "widgets");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "notes.txt"), "mine");

    await expect(cloner.clone(ORIGIN)).rejects.toThrow(`${target} is a folder with files in it, not a clone`);
    expect(await readdir(target)).toEqual(["notes.txt"]);
    expect(calls).toEqual([]);
    expect(pushes).toEqual([]);
    expect(repos.all()).toEqual([]);
    // Refused, not stuck: the next try is checked again.
    await expect(cloner.clone(ORIGIN)).rejects.toBeInstanceOf(CloneError);
  });
});

describe("inspectTarget", () => {
  it("is empty for a missing or empty folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-clone-"));
    expect(await inspectTarget(realExec, join(root, "missing"), ORIGIN)).toBe("empty");
    await mkdir(join(root, "empty"));
    expect(await inspectTarget(realExec, join(root, "empty"), ORIGIN)).toBe("empty");
  });

  it("refuses a clone of another origin, a clone without origin and a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "donepm-clone-"));
    const other = join(root, "other");
    await mkdir(other);
    execFileSync("git", ["init", "-q"], { cwd: other });
    await expect(inspectTarget(realExec, other, ORIGIN)).rejects.toThrow(`${other} is a git repository without an origin`);
    git(other, "remote", "add", "origin", "git@github.com:someone/else.git");
    await expect(inspectTarget(realExec, other, ORIGIN)).rejects.toThrow(`${other} is a clone of github.com/someone/else`);
    await writeFile(join(root, "file"), "x");
    await expect(inspectTarget(realExec, join(root, "file"), ORIGIN)).rejects.toMatchObject({ status: 409 });
    expect(existsSync(join(other, ".git"))).toBe(true);
  });
});
