export type PackageManager = "pnpm" | "bun" | "yarn" | "npm" | "composer";

/** How one package manager's dependencies get into a new worktree (spec 7.3, D34). */
export interface DependencyPlan {
  manager: PackageManager;
  /** In the repository root; compared between main clone and worktree. */
  lockfile: string;
  /** Install command, run by the daemon in the worktree when cloning is not possible. */
  install: { cmd: string; args: string[] };
}

interface Candidate {
  manager: PackageManager;
  lockfiles: string[];
  install: (files: ReadonlySet<string>) => string[];
}

// One JavaScript manager per repo: they all write the same `node_modules`. Listed by priority, so a
// repo that switched to pnpm and kept an old `package-lock.json` uses pnpm.
const JS: Candidate[] = [
  { manager: "pnpm", lockfiles: ["pnpm-lock.yaml"], install: () => ["install", "--frozen-lockfile"] },
  { manager: "bun", lockfiles: ["bun.lock", "bun.lockb"], install: () => ["install", "--frozen-lockfile"] },
  {
    manager: "yarn",
    lockfiles: ["yarn.lock"],
    // Yarn Berry (configured by `.yarnrc.yml`) renamed the flag.
    install: (files) => ["install", files.has(".yarnrc.yml") ? "--immutable" : "--frozen-lockfile"],
  },
  { manager: "npm", lockfiles: ["package-lock.json"], install: () => ["ci"] },
];

const PHP: Candidate = { manager: "composer", lockfiles: ["composer.lock"], install: () => ["install", "--no-interaction"] };

function plan(c: Candidate, files: ReadonlySet<string>): DependencyPlan | undefined {
  const lockfile = c.lockfiles.find((f) => files.has(f));
  if (!lockfile) return undefined;
  return { manager: c.manager, lockfile, install: { cmd: c.manager, args: c.install(files) } };
}

/** The package managers a repository uses, from the file names in its root. */
export function detectDependencies(rootFiles: Iterable<string>): DependencyPlan[] {
  const files = new Set(rootFiles);
  const js = JS.map((c) => plan(c, files)).find((p) => p !== undefined);
  return [js, plan(PHP, files)].filter((p): p is DependencyPlan => p !== undefined);
}

/**
 * The dependency directories of a manager, relative to the repository root. JavaScript managers
 * have one `node_modules` per package of a workspace, so the caller passes the tracked
 * `package.json` paths; Composer has one `vendor`.
 */
export function dependencyDirs(manager: PackageManager, packageJsonPaths: readonly string[]): string[] {
  if (manager === "composer") return ["vendor"];
  const dirs = new Set(["node_modules"]);
  for (const path of packageJsonPaths) {
    if (path === "package.json") continue;
    if (!path.endsWith("/package.json")) continue;
    dirs.add(`${path.slice(0, -"package.json".length)}node_modules`);
  }
  return [...dirs].sort();
}

/** The install command as one line, for the transcript. */
export function installCommand(p: DependencyPlan): string {
  return [p.install.cmd, ...p.install.args].join(" ");
}
