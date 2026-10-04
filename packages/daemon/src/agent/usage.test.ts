import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addUsage, usageFromPayload, usageFromResult } from "./usage.js";

describe("usageFromResult", () => {
  it("maps Claude Code usage with cache counted into the input", () => {
    expect(usageFromResult({ input_tokens: 18, cache_creation_input_tokens: 7509, cache_read_input_tokens: 44126, output_tokens: 611 })).toEqual({
      inputTokens: 18 + 7509 + 44126,
      outputTokens: 611,
      cacheReadInputTokens: 44126,
      cacheWriteInputTokens: 7509,
    });
  });

  it("maps the usage of a recorded result", () => {
    const line = readFileSync(new URL("../../fixtures/stream/basic.jsonl", import.meta.url), "utf8").split("\n").find((l) => l.includes('"type":"result"'))!;
    expect(usageFromResult(JSON.parse(line).usage)).toEqual({ inputTokens: 18 + 11565 + 39765, outputTokens: 519, cacheReadInputTokens: 39765, cacheWriteInputTokens: 11565 });
  });

  it("copes with missing fields and unknown shapes", () => {
    expect(usageFromResult({ output_tokens: 5 })).toEqual({ inputTokens: 0, outputTokens: 5, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 });
    for (const bad of [undefined, null, "x", 3, []]) expect(usageFromResult(bad)).toBeUndefined();
  });
});

describe("usageFromPayload and addUsage", () => {
  it("reads a stored payload and adds two", () => {
    const a = { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 4, cacheWriteInputTokens: 1 };
    expect(usageFromPayload(a)).toEqual(a);
    expect(usageFromPayload({ inputTokens: "x" })).toBeUndefined();
    expect(addUsage(a, a)).toEqual({ inputTokens: 20, outputTokens: 4, cacheReadInputTokens: 8, cacheWriteInputTokens: 2 });
  });
});
