import type { TokenUsage } from "@donepm/core";

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Maps `result.usage` of Claude Code; undefined when it is missing or not an object. Never throws. */
export function usageFromResult(usage: unknown): TokenUsage | undefined {
  if (typeof usage !== "object" || usage === null || Array.isArray(usage)) return undefined;
  const u = usage as Record<string, unknown>;
  const cacheRead = count(u.cache_read_input_tokens);
  const cacheWrite = count(u.cache_creation_input_tokens);
  return {
    inputTokens: count(u.input_tokens) + cacheRead + cacheWrite,
    outputTokens: count(u.output_tokens),
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
  };
}
