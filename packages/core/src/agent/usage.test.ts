import { describe, expect, it } from "vitest";
import { addUsage, usageFromPayload } from "./usage.js";

describe("usageFromPayload and addUsage", () => {
  it("reads a stored payload and adds two", () => {
    const a = { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 4, cacheWriteInputTokens: 1 };
    expect(usageFromPayload(a)).toEqual(a);
    expect(usageFromPayload({ inputTokens: "x" })).toBeUndefined();
    expect(addUsage(a, a)).toEqual({ inputTokens: 20, outputTokens: 4, cacheReadInputTokens: 8, cacheWriteInputTokens: 2 });
  });

  it("counts a field the agent did not report as 0", () => {
    expect(usageFromPayload({ inputTokens: 5, outputTokens: 1 })).toEqual({ inputTokens: 5, outputTokens: 1, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 });
  });
});
