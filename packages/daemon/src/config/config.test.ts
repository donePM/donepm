import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_CONFIG, loadConfig, parseConfig } from "./config.js";
import { expandHome, pathsFor } from "./paths.js";

describe("config", () => {
  it("has the spec 14 defaults", () => {
    expect(DEFAULT_CONFIG).toEqual({
      port: 6174,
      repoRoot: "~/Code",
      worktreeRoot: "~/.local/share/donepm/worktrees",
      branchPrefix: "dp/",
      pollIntervalSeconds: 60,
      maxConcurrentAgents: 1,
    });
  });

  it("creates the file with defaults on first start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "donepm-cfg-"));
    const file = join(dir, "nested", "config.json");
    const first = await loadConfig(file);
    expect(first).toEqual({ config: DEFAULT_CONFIG, created: true });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(DEFAULT_CONFIG);
    expect((await loadConfig(file)).created).toBe(false);
  });

  it("fills missing keys with defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "donepm-cfg-"));
    const file = join(dir, "config.json");
    await writeFile(file, JSON.stringify({ repoRoot: "~/work" }));
    expect((await loadConfig(file)).config).toEqual({ ...DEFAULT_CONFIG, repoRoot: "~/work" });
  });

  it("rejects invalid JSON, wrong types and unknown keys", () => {
    expect(() => parseConfig("{")).toThrow(ConfigError);
    expect(() => parseConfig('{"port":"x"}')).toThrow(/port/);
    expect(() => parseConfig('{"prot":1}')).toThrow(ConfigError);
  });
});

describe("paths", () => {
  it("derives config and data locations from home", () => {
    expect(pathsFor("/h")).toEqual({
      home: "/h",
      configDir: "/h/.config/donepm",
      configFile: "/h/.config/donepm/config.json",
      dataDir: "/h/.local/share/donepm",
      dbFile: "/h/.local/share/donepm/donepm.db",
    });
  });

  it("expands a leading tilde only", () => {
    expect(expandHome("~/Code", "/h")).toBe("/h/Code");
    expect(expandHome("~", "/h")).toBe("/h");
    expect(expandHome("/abs/~/x", "/h")).toBe("/abs/~/x");
  });
});
