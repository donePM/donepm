import type { Event, EventType } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { agentHistory } from "./agent-info.js";

let n = 0;
const ev = (type: EventType, at: string, payload: Record<string, unknown> = {}): Event => ({
  id: `e${++n}`,
  itemId: "i1",
  at,
  actor: "system",
  type,
  payload,
});

describe("agentHistory", () => {
  it("is empty before any agent ran", () => {
    expect(agentHistory([ev("item.collected", "t0")])).toEqual({});
  });

  it("takes the latest start and the last cost of one process", () => {
    expect(
      agentHistory([
        ev("agent.started", "t1"),
        ev("agent.turn_ended", "t2", { costUsd: 0.1 }),
        ev("agent.turn_started", "t3"),
        ev("agent.turn_ended", "t4", { costUsd: 0.25 }),
      ]),
    ).toEqual({ startedAt: "t1", costUsd: 0.25 });
  });

  it("adds up the processes when the agent is resumed", () => {
    expect(
      agentHistory([
        ev("agent.started", "t1"),
        ev("agent.turn_ended", "t2", { costUsd: 0.25 }),
        ev("agent.failed", "t3"),
        ev("agent.resumed", "t4"),
        ev("agent.turn_ended", "t5", { costUsd: 0.5 }),
      ]),
    ).toEqual({ startedAt: "t4", costUsd: 0.75 });
  });

  it("ignores turns without a cost", () => {
    expect(agentHistory([ev("agent.started", "t1"), ev("agent.turn_ended", "t2", { isError: true })])).toEqual({ startedAt: "t1" });
  });
});
