import { describe, expect, it } from "vitest";
import type { Status } from "../../api/types";
import { PLANNED, toolGroups, toolRows } from "./catalog";

const status: Status = {
  version: "1", pid: 1, startedAt: "2026-10-01T00:00:00.000Z", runningAgents: 0, pollErrors: [],
  gh: { state: "ready", path: "/opt/homebrew/bin/gh", account: "octocat" },
  claude: { state: "not_logged_in", path: "/usr/local/bin/claude", version: "2.1.288" },
  helpers: { "playwright-cli": { installed: true, path: "/opt/homebrew/bin/playwright-cli", version: "0.1.1" } },
};

describe("toolRows", () => {
  it("puts each tool in one category", () => {
    expect(toolRows(status).map((r) => [r.id, r.category])).toEqual([
      ["claude", "agent"],
      ["gh", "source"],
      ["playwright-cli", "helper"],
    ]);
    expect(PLANNED.map((p) => [p.id, p.category])).toEqual([
      ["codex", "agent"],
      ["jira", "source"],
      ["az", "source"],
    ]);
  });

  it("describes each tool from the status", () => {
    const [claude, gh, pw] = toolRows(status);
    expect(claude).toMatchObject({ tag: "claude 2.1.288", hint: { tone: "warn", command: "claude auth login" } });
    expect(gh).toMatchObject({ ready: "logged in as octocat", hint: { tone: "ok" } });
    expect(pw).toMatchObject({ tag: "playwright-cli 0.1.1", hint: { tone: "ok" }, detail: "/opt/homebrew/bin/playwright-cli · drives a browser, for agents that check a UI" });
  });

  it("has no hint until the daemon has checked, then a missing helper is muted", () => {
    expect(toolRows(undefined).every((r) => r.hint === undefined)).toBe(true);
    const pw = toolRows({ ...status, helpers: {} }).find((r) => r.id === "playwright-cli");
    expect(pw?.hint).toMatchObject({ label: "not installed", tone: "muted", command: "npm install -g @playwright/cli@latest" });
  });
});

describe("toolGroups", () => {
  it("shows only coding agents in Agents & access", () => {
    const groups = toolGroups(status, ["agent"]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id), g.planned.map((p) => p.id)])).toEqual([
      ["Coding agents", ["claude"], ["codex"]],
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
