import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { agentGroups, FINISHED_SHOWN } from "./groups";

const item = (id: string, over: Partial<ItemView>): ItemView => ({
  id, source: "github-issue", externalId: `o/r#${id}`, externalUrl: "", title: id, body: "", labels: [],
  state: "ready", playbook: "implement", priority: 1, createdAt: "t0", updatedAt: "t0",
  repo: null, badges: [], agent: { running: false }, ...over,
});

describe("agentGroups", () => {
  it("leaves out items that never had an agent", () => {
    expect(agentGroups([item("a", {})])).toEqual({ running: [], waiting: [], finished: [] });
  });

  it("groups by state", () => {
    const g = agentGroups([
      item("run", { state: "running", agent: { running: true, startedAt: "t1" } }),
      item("ask", { state: "needs_you", agent: { running: true, startedAt: "t1" } }),
      item("fail", { state: "failed", agent: { running: false, startedAt: "t1" } }),
      item("done", { state: "done", agent: { running: false, startedAt: "t1" } }),
    ]);
    expect(g.running.map((i) => i.id)).toEqual(["run"]);
    expect(g.waiting.map((i) => i.id)).toEqual(["ask"]);
    expect(g.finished.map((i) => i.id).sort()).toEqual(["done", "fail"]);
  });

  it("keeps a reserved start that has no start time yet", () => {
    expect(agentGroups([item("a", { state: "running", agent: { running: true } })]).running).toHaveLength(1);
  });

  it("orders finished by most recent and keeps only the latest ones", () => {
    const many = Array.from({ length: FINISHED_SHOWN + 2 }, (_, n) =>
      item(`d${n}`, { state: "done", updatedAt: `t${String(n).padStart(2, "0")}`, agent: { running: false, startedAt: "t" } }),
    );
    const finished = agentGroups(many).finished;
    expect(finished).toHaveLength(FINISHED_SHOWN);
    expect(finished[0]!.id).toBe(`d${FINISHED_SHOWN + 1}`);
  });
});
