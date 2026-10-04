import { describe, expect, it } from "vitest";
import { isStored, storedKind, type AgentEvent } from "./events.js";

describe("AgentEvent helpers", () => {
  it("stores messages and raw lines, nothing else", () => {
    const events: AgentEvent[] = [
      { type: "message", kind: "assistant_text", raw: { a: 1 } },
      { type: "raw", raw: { b: 2 } },
      { type: "live", event: {} },
      { type: "session_bound", sessionId: "s" },
      { type: "turn_started" },
      { type: "tool_started", id: "t", name: "Bash", summary: "ls" },
      { type: "tool_finished", id: "t" },
      { type: "usage", costUsd: 1 },
      { type: "turn_ended", isError: false, interrupted: false },
      { type: "malformed", line: "{" },
    ];
    const stored = events.filter(isStored);
    expect(stored.map(storedKind)).toEqual(["assistant_text", "raw"]);
  });
});
