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
      previousWorktreeRoots: [],
      branchPrefix: "dp/",
      pollIntervalSeconds: 60,
      maxConcurrentAgents: 1,
      removeWorktreeOnMerge: false,
      archiveAfterHours: 24,
      deleteAfterDays: 7,
      sources: {},
      ticketSources: [],
      allowedWebFetchDomains: ["github.com", "raw.githubusercontent.com", "docs.github.com", "nodejs.org", "developer.mozilla.org", "npmjs.com"],
    });
  });

  it("normalises WebFetch domains and rejects URLs and wildcards", () => {
    expect(parseConfig(JSON.stringify({ allowedWebFetchDomains: [" Docs.GitHub.com "] })).allowedWebFetchDomains).toEqual(["docs.github.com"]);
    expect(parseConfig(JSON.stringify({ allowedWebFetchDomains: [] })).allowedWebFetchDomains).toEqual([]);
    expect(() => parseConfig(JSON.stringify({ allowedWebFetchDomains: ["https://github.com"] }))).toThrow(/allowedWebFetchDomains\.0/);
    expect(() => parseConfig(JSON.stringify({ allowedWebFetchDomains: ["*.github.com"] }))).toThrow(ConfigError);
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
    expect(() => parseConfig('{"removeWorktreeOnMerge":"yes"}')).toThrow(/removeWorktreeOnMerge/);
  });

  it("keeps the remove-on-merge opt-in", () => {
    expect(parseConfig('{"removeWorktreeOnMerge":true}').removeWorktreeOnMerge).toBe(true);
  });

  it("takes retention as whole numbers from 0, deleteAfterDays null for never (D37)", () => {
    expect(parseConfig('{"archiveAfterHours":0,"deleteAfterDays":null}')).toMatchObject({ archiveAfterHours: 0, deleteAfterDays: null });
    expect(parseConfig('{"archiveAfterHours":48,"deleteAfterDays":30}')).toMatchObject({ archiveAfterHours: 48, deleteAfterDays: 30 });
    expect(() => parseConfig('{"archiveAfterHours":-1}')).toThrow(/archiveAfterHours/);
    expect(() => parseConfig('{"archiveAfterHours":1.5}')).toThrow(/archiveAfterHours/);
    expect(() => parseConfig('{"archiveAfterHours":null}')).toThrow(/archiveAfterHours/);
    expect(() => parseConfig('{"deleteAfterDays":-1}')).toThrow(/deleteAfterDays/);
    expect(() => parseConfig('{"deleteAfterDays":"7"}')).toThrow(/deleteAfterDays/);
  });
});

describe("sources", () => {
  it("accepts a query and the assign opt-in per normalised origin", () => {
    const c = parseConfig(JSON.stringify({
      sources: { "github.com/spatie/bloom": { query: " is:issue no:assignee ", assignOnStart: true }, "github.com/o/r": {} },
    }));
    expect(c.sources).toEqual({
      "github.com/spatie/bloom": { query: "is:issue no:assignee", assignOnStart: true },
      "github.com/o/r": { assignOnStart: false },
    });
  });

  it("accepts the ignored flag next to the other fields and by itself", () => {
    const c = parseConfig(JSON.stringify({
      sources: { "github.com/o/r": { ignored: true }, "github.com/o/q": { query: "is:issue", ignored: false } },
    }));
    expect(c.sources).toEqual({
      "github.com/o/r": { assignOnStart: false, ignored: true },
      "github.com/o/q": { query: "is:issue", assignOnStart: false, ignored: false },
    });
    expect(parseConfig('{"sources":{"github.com/o/r":{}}}').sources["github.com/o/r"]).not.toHaveProperty("ignored");
  });

  it("accepts the playbooks offered per ingest (#153)", () => {
    const c = parseConfig(JSON.stringify({
      sources: { "github.com/o/r": { playbook: "fix", playbooks: { issue: ["implement", "fix"], pr: ["review"] } } },
    }));
    expect(c.sources["github.com/o/r"]).toEqual({
      playbook: "fix",
      playbooks: { issue: ["implement", "fix"], pr: ["review"] },
      assignOnStart: false,
    });
  });

  it("rejects empty or unknown ingest lists and a default outside the issue playbooks (#153)", () => {
    expect(() => parseConfig('{"sources":{"github.com/o/r":{"playbooks":{"issue":[]}}}}')).toThrow(/playbooks/);
    expect(() => parseConfig('{"sources":{"github.com/o/r":{"playbooks":{"mr":["x"]}}}}')).toThrow(ConfigError);
    expect(() => parseConfig('{"sources":{"github.com/o/r":{"playbook":"fix","playbooks":{"issue":["implement"]}}}}')).toThrow(
      /default playbook must be one of/,
    );
  });

  it("rejects an ignored flag that is not a boolean", () => {
    expect(() => parseConfig('{"sources":{"github.com/o/r":{"ignored":"yes"}}}')).toThrow(/ignored/);
  });

  it("rejects keys that are not normalised, other providers and unknown fields", () => {
    expect(() => parseConfig('{"sources":{"https://github.com/o/r":{}}}')).toThrow(/normalised origin/);
    expect(() => parseConfig('{"sources":{"GitHub.com/o/r":{}}}')).toThrow(/normalised origin/);
    expect(() => parseConfig('{"sources":{"gitlab.com/o/r":{}}}')).toThrow(/sources.gitlab.com\/o\/r: no connection for gitlab.com/);
    expect(() => parseConfig('{"sources":{"github.com/o/r":{"query":""}}}')).toThrow(/query/);
    expect(() => parseConfig('{"sources":{"github.com/o/r":{"jql":"x"}}}')).toThrow(ConfigError);
  });

  it("takes sources on the hosts its connections serve", () => {
    const connections = '[{"id":"acme","kind":"github","host":"github.acme.com"}]';
    const c = parseConfig(`{"connections":${connections},"sources":{"github.acme.com/team/app":{"managed":true}}}`);
    expect(c.connections).toEqual([{ id: "acme", kind: "github", backend: "cli", host: "github.acme.com" }]);
    // A connections list is the whole set: github.com is no longer implied.
    expect(() => parseConfig(`{"connections":${connections},"sources":{"github.com/o/r":{}}}`)).toThrow(/no connection for github.com/);
    expect(() => parseConfig('{"sources":{"constructor/o/r":{}}}')).toThrow(/no connection for constructor/);
  });
});

describe("paths", () => {
  it("derives config and data locations from home", () => {
    expect(pathsFor("/h")).toEqual({
      home: "/h",
      configDir: "/h/.config/donepm",
      configFile: "/h/.config/donepm/config.json",
      playbooksDir: "/h/.config/donepm/playbooks",
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
