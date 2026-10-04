import { describe, expect, it } from "vitest";
import type { Event } from "../event/types.js";
import { ciFailureOf, ciWaitOf } from "./state.js";

let n = 0;
const ev = (type: string, payload: Record<string, unknown> = {}): Event => {
  n++;
  return { id: `e${n}`, itemId: "i", at: `2026-10-04T10:${String(n).padStart(2, "0")}:00Z`, actor: "system", type: type as Event["type"], payload };
};
const pr = { number: 7, url: "https://github.com/o/r/pull/7" };
const failed = [{ name: "test", link: "https://github.com/o/r/actions/runs/9/job/1" }];

describe("ciWaitOf", () => {
  it("is the last ci.started with its PR", () => {
    const first = ev("ci.started", pr);
    const rerun = ev("ci.started", { ...pr, reason: "rerun" });
    expect(ciWaitOf([first, ev("ci.failed", { ...pr, failed }), rerun])).toEqual({ since: rerun.at, pr });
  });

  it("is undefined without a PR", () => {
    expect(ciWaitOf([ev("ci.started", {})])).toBeUndefined();
    expect(ciWaitOf([])).toBeUndefined();
  });
});

describe("ciFailureOf", () => {
  it("is the red CI while nothing happened after it", () => {
    const events = [ev("ci.started", pr), ev("ci.failed", { ...pr, failed, logs: [{ name: "test", tail: "boom" }] }), ev("item.assigned")];
    expect(ciFailureOf(events)).toEqual({ pr, failed, logs: [{ name: "test", tail: "boom" }], runs: ["9"] });
  });

  it.each(["agent.resumed", "ci.started", "ci.marked_done", "draft.created"])("is gone after %s", (type) => {
    expect(ciFailureOf([ev("ci.failed", { ...pr, failed }), ev(type)])).toBeUndefined();
  });

  it("drops malformed entries", () => {
    expect(ciFailureOf([ev("ci.failed", { failed: [{ name: "a" }, { x: 1 }, null], logs: "x" })])).toEqual({ failed: [{ name: "a" }], logs: [], runs: [] });
  });
});
