import { describe, expect, it } from "vitest";
import { POLL_ERRORS_KEPT, StatusStore } from "./status.js";

describe("StatusStore", () => {
  it("keeps the last failed polls, newest first", () => {
    const s = new StatusStore("1.0.0", "2026-09-01T00:00:00Z", 42);
    for (let i = 1; i <= POLL_ERRORS_KEPT + 2; i++) s.update({ lastPoll: { at: `t${i}`, ok: false, error: `e${i}` } });
    s.update({ lastPoll: { at: "ok", ok: true, issues: 3 } });
    expect(s.get().pollErrors.map((e) => e.error)).toEqual(["e7", "e6", "e5", "e4", "e3"]);
    expect(s.get()).toMatchObject({ pid: 42, startedAt: "2026-09-01T00:00:00Z", lastPoll: { at: "ok", ok: true } });
  });

  it("notifies listeners of every change", () => {
    const s = new StatusStore("1.0.0", "t0");
    const seen: number[] = [];
    s.onChange((st) => seen.push(st.runningAgents));
    s.update({ runningAgents: 2 });
    expect(seen).toEqual([2]);
  });
});
