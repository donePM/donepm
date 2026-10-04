import { describe, expect, it } from "vitest";
import { dependencyDirs, detectDependencies, installCommand } from "./dependencies.js";

const managers = (files: string[]) => detectDependencies(files).map((p) => [p.manager, p.lockfile, installCommand(p)]);

describe("detectDependencies", () => {
  it("finds each manager by its lockfile", () => {
    expect(managers(["package.json", "pnpm-lock.yaml"])).toEqual([["pnpm", "pnpm-lock.yaml", "pnpm install --frozen-lockfile"]]);
    expect(managers(["package-lock.json"])).toEqual([["npm", "package-lock.json", "npm ci"]]);
    expect(managers(["bun.lockb"])).toEqual([["bun", "bun.lockb", "bun install --frozen-lockfile"]]);
    expect(managers(["bun.lock"])).toEqual([["bun", "bun.lock", "bun install --frozen-lockfile"]]);
    expect(managers(["composer.lock"])).toEqual([["composer", "composer.lock", "composer install --no-interaction"]]);
  });

  it("tells Yarn Berry from Yarn 1 by .yarnrc.yml", () => {
    expect(managers(["yarn.lock"])).toEqual([["yarn", "yarn.lock", "yarn install --frozen-lockfile"]]);
    expect(managers(["yarn.lock", ".yarnrc.yml"])).toEqual([["yarn", "yarn.lock", "yarn install --immutable"]]);
  });

  it("picks one JavaScript manager, pnpm first, next to Composer", () => {
    expect(managers(["package-lock.json", "pnpm-lock.yaml", "composer.lock"])).toEqual([
      ["pnpm", "pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
      ["composer", "composer.lock", "composer install --no-interaction"],
    ]);
  });

  it("finds nothing without a lockfile", () => {
    expect(detectDependencies(["package.json", "composer.json", "README.md"])).toEqual([]);
  });
});

describe("dependencyDirs", () => {
  it("has one node_modules per workspace package", () => {
    expect(dependencyDirs("pnpm", ["package.json", "packages/web/package.json", "packages/core/package.json"])).toEqual([
      "node_modules",
      "packages/core/node_modules",
      "packages/web/node_modules",
    ]);
  });

  it("ignores files that only end in package.json", () => {
    expect(dependencyDirs("npm", ["fixtures/not-a-package.json"])).toEqual(["node_modules"]);
  });

  it("has vendor for Composer", () => {
    expect(dependencyDirs("composer", ["package.json"])).toEqual(["vendor"]);
  });
});
