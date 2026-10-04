import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { agentGroups, FINISHED_SHOWN } from "./groups";

const NOW = new Date(2026, 9, 4, 15, 0).getTime();
const today = (h: number, m = 0) => new Date(2026, 9, 4, h, m).toISOString();

const item = (id: string, over: Partial<ItemView>): ItemView => ({
  id, source: "github-issue", externalId: `o/r#${id}`, externalUrl: "", title: id, body: "", labels: [],
  state: "ready", playbook: "implement", priority: 1, stateSince: "t0", createdAt: "t0", updatedAt: today(9),
  repo: null, badges: [], agent: { running: false }, ...over,
});

describe("agentGroups", () => {
  it("leaves out items that never had an agent", () => {
    expect(agentGroups([item("a", {})], NOW)).toEqual({ running: [], checking: [], waiting: [], finished: [] });
  });

  it("groups by state", () => {
    const g = agentGroups([
      item("run", { state: "running", agent: { running: true, startedAt: "t1" } }),
      item("ci", { state: "checking", agent: { running: false, startedAt: "t1" } }),
      item("ask", { state: "needs_you", agent: { running: true, startedAt: "t1" } }),
      item("fail", { state: "failed", agent: { running: false, startedAt: "t1" } }),
      item("done", { state: "done", agent: { running: false, startedAt: "t1" } }),
    ], NOW);
    expect(g.running.map((i) => i.id)).toEqual(["run"]);
    expect(g.checking.map((i) => i.id)).toEqual(["ci"]);
    expect(g.waiting.map((i) => i.id).sort()).toEqual(["ask", "fail"]);
    expect(g.finished.map((i) => i.id)).toEqual(["done"]);
  });

  it("keeps a reserved start that has no start time yet", () => {
    expect(agentGroups([item("a", { state: "running", agent: { running: true } })], NOW).running).toHaveLength(1);
  });

  it("leaves out agents that finished before today", () => {
    const old = item("old", { state: "done", updatedAt: new Date(2026, 9, 3, 23, 0).toISOString(), agent: { running: false, startedAt: "t" } });
    expect(agentGroups([old], NOW).finished).toEqual([]);
  });

  it("orders finished by most recent and keeps only the latest ones", () => {
    const many = Array.from({ length: FINISHED_SHOWN + 2 }, (_, n) =>
      item(`d${n}`, { state: "done", updatedAt: today(10, n), agent: { running: false, startedAt: "t" } }),
    );
    const finished = agentGroups(many, NOW).finished;
    expect(finished).toHaveLength(FINISHED_SHOWN);
    expect(finished[0]!.id).toBe(`d${FINISHED_SHOWN + 1}`);
  });
});
