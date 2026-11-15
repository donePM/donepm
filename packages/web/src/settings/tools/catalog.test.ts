import { describe, expect, it } from "vitest";
import type { Status } from "../../api/types";
import { PLANNED, toolGroups, toolRows } from "./catalog";

const status: Status = {
  version: "1", pid: 1, startedAt: "2026-10-01T00:00:00.000Z", runningAgents: 0, pollErrors: [],
  gh: { state: "ready", path: "/opt/homebrew/bin/gh", account: "octocat" },
  claude: { state: "not_logged_in", path: "/usr/local/bin/claude", version: "2.1.288" },
  codex: { state: "ready", path: "/opt/homebrew/bin/codex", version: "0.133.0" },
  helpers: { "playwright-cli": { installed: true, path: "/opt/homebrew/bin/playwright-cli", version: "0.1.1" } },
};

describe("toolRows", () => {
  it("puts each tool in one category", () => {
    expect(toolRows(status).map((r) => [r.id, r.category])).toEqual([
      ["claude", "agent"],
      ["codex", "agent"],
      ["gh", "source"],
      ["playwright-cli", "helper"],
    ]);
    expect(PLANNED.map((p) => [p.id, p.category])).toEqual([
      ["jira", "source"],
      ["az", "source"],
    ]);
  });

  it("describes each tool from the status", () => {
    const [claude, codex, gh, pw] = toolRows(status);
    expect(claude).toMatchObject({ tag: "claude 2.1.288", hint: { tone: "warn", command: "claude auth login" } });
    expect(codex).toMatchObject({ tag: "codex 0.133.0", hint: { tone: "ok" }, detail: "/opt/homebrew/bin/codex · runs items whose card or playbook picks it" });
    expect(gh).toMatchObject({ ready: "logged in as octocat", hint: { tone: "ok" } });
    expect(pw).toMatchObject({ tag: "playwright-cli 0.1.1", hint: { tone: "ok" }, detail: "/opt/homebrew/bin/playwright-cli · drives a browser, for agents that check a UI" });
  });

  it("adds a row per further GitHub host, after github.com (issue #140)", () => {
    const rows = toolRows({ ...status, ghHosts: { "github.acme.com": { state: "not_logged_in", path: "/opt/homebrew/bin/gh" } } });
    expect(rows.map((r) => r.id)).toEqual(["claude", "codex", "gh", "gh:github.acme.com", "playwright-cli"]);
    expect(rows[3]).toMatchObject({
      category: "source", name: "GitHub CLI on github.acme.com",
      hint: { tone: "warn", command: "gh auth login --hostname github.acme.com" }, detail: "/opt/homebrew/bin/gh · used for github.acme.com",
    });
  });

  it("has no hint until the daemon has checked, then a missing helper is muted", () => {
    expect(toolRows(undefined).every((r) => r.hint === undefined)).toBe(true);
    const pw = toolRows({ ...status, helpers: {} }).find((r) => r.id === "playwright-cli");
    expect(pw?.hint).toMatchObject({ label: "not installed", tone: "muted", command: "npm install -g @playwright/cli@latest" });
  });

  it("mutes a missing Codex, which is optional, and warns when it is logged out (#137)", () => {
    const codex = (s: Status) => toolRows(s).find((r) => r.id === "codex");
    const { codex: _, ...without } = status;
    expect(codex(without)?.hint).toMatchObject({ label: "not installed", tone: "muted" });
    expect(codex({ ...status, codex: { state: "not_logged_in" } })?.hint).toMatchObject({ tone: "warn", command: "codex login" });
  });
});

describe("toolGroups", () => {
  it("shows only coding agents in Agents & access", () => {
    const groups = toolGroups(status, ["agent"]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id), g.planned.map((p) => p.id)])).toEqual([
      ["Coding agents", ["claude", "codex"], []],
    ]);
  });

  it("shows source clients, then helpers in Tools", () => {
    const groups = toolGroups(status, ["source", "helper"]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id), g.planned.map((p) => p.id)])).toEqual([
      ["Source clients", ["gh"], ["jira", "az"]],
      ["Helpers", ["playwright-cli"], []],
    ]);
  });

  it("lists no tool on both pages", () => {
    const ids = (cats: Parameters<typeof toolGroups>[1]) => toolGroups(status, cats).flatMap((g) => [...g.rows.map((r) => r.id), ...g.planned.map((p) => p.id)]);
    const agents = ids(["agent"]);
    expect(ids(["source", "helper"]).filter((id) => agents.includes(id))).toEqual([]);
  });
});
