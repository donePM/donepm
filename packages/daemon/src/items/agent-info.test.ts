import type { Event, EventType } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { agentHistory } from "./agent-info.js";

let n = 0;
/** `at` is minutes after 09:00. */
const ev = (type: EventType, min: number, payload: Record<string, unknown> = {}): Event => ({
  id: `e${++n}`,
  itemId: "i1",
  at: t(min),
  actor: "system",
  type,
  payload,
});
const t = (min: number) => new Date(Date.UTC(2026, 9, 4, 9, min)).toISOString();
const MIN = 60_000;

describe("agentHistory", () => {
  it("is empty before any agent ran", () => {
    expect(agentHistory([ev("item.collected", 0)])).toEqual({});
  });

  it("takes the latest start and the last cost of one process", () => {
    expect(
      agentHistory([
        ev("agent.started", 1),
        ev("agent.turn_ended", 2, { costUsd: 0.1 }),
        ev("agent.turn_started", 3),
        ev("agent.turn_ended", 4, { costUsd: 0.25 }),
      ]),
    ).toMatchObject({ startedAt: t(1), costUsd: 0.25 });
  });

  it("adds up the processes when the agent is resumed", () => {
    expect(
      agentHistory([
        ev("agent.started", 1),
        ev("agent.turn_ended", 2, { costUsd: 0.25 }),
        ev("agent.failed", 3),
        ev("agent.resumed", 4),
        ev("agent.turn_ended", 5, { costUsd: 0.5 }),
      ]),
    ).toMatchObject({ startedAt: t(4), costUsd: 0.75 });
  });

  it("ignores turns without a cost", () => {
    expect(agentHistory([ev("agent.started", 1), ev("agent.turn_ended", 2, { isError: true })])).not.toHaveProperty("costUsd");
  });
});

describe("agentHistory: elapsed time", () => {
  it("counts a running agent from its start", () => {
    expect(agentHistory([ev("agent.started", 0)])).toMatchObject({ elapsedMs: 0, activeSince: t(0) });
  });

  it("continues after an interrupt and a resume", () => {
    const events = [ev("agent.started", 0), ev("agent.interrupted", 3), ev("agent.resumed", 10)];
    expect(agentHistory(events)).toMatchObject({ startedAt: t(10), elapsedMs: 3 * MIN, activeSince: t(10) });
    expect(agentHistory([...events, ev("agent.turn_ended", 12)])).toEqual({ startedAt: t(10), elapsedMs: 5 * MIN });
  });

  it("does not count the time a permission question waits", () => {
    const events = [
      ev("agent.started", 0),
      ev("permission.asked", 2),
      ev("permission.answered", 30),
      ev("agent.turn_ended", 31),
      ev("agent.turn_started", 40),
    ];
    expect(agentHistory(events)).toMatchObject({ elapsedMs: 3 * MIN, activeSince: t(40) });
  });

  it("starts at zero after a fresh retry", () => {
    const events = [ev("agent.started", 0), ev("agent.failed", 5), ev("agent.started", 20)];
    expect(agentHistory(events)).toMatchObject({ elapsedMs: 0, activeSince: t(20) });
  });
});
