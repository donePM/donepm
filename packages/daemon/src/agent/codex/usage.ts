import type { TokenUsage } from "@donepm/core";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * Codex's `TokenUsageBreakdown` (`thread/tokenUsage/updated`) in donePM's words. Its `inputTokens`
 * already counts the cached ones, as donePM's does. Undefined when it is not an object.
 */
export function codexTokens(breakdown: unknown): TokenUsage | undefined {
  if (!isObject(breakdown)) return undefined;
  return {
    inputTokens: count(breakdown.inputTokens),
    outputTokens: count(breakdown.outputTokens),
    cacheReadInputTokens: count(breakdown.cachedInputTokens),
    cacheWriteInputTokens: count(breakdown.cacheWriteInputTokens),
    reasoningTokens: count(breakdown.reasoningOutputTokens),
  };
}

/** `a - b`, field by field, never below 0. */
export function subtractUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const d = (x: number, y: number) => Math.max(0, x - y);
  return {
    inputTokens: d(a.inputTokens, b.inputTokens),
    outputTokens: d(a.outputTokens, b.outputTokens),
    cacheReadInputTokens: d(a.cacheReadInputTokens, b.cacheReadInputTokens),
    cacheWriteInputTokens: d(a.cacheWriteInputTokens, b.cacheWriteInputTokens),
    reasoningTokens: d(a.reasoningTokens ?? 0, b.reasoningTokens ?? 0),
  };
}
