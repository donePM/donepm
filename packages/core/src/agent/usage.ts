/**
 * Token usage with the names of the Laravel AI SDK (`TextUsage`). As there, `inputTokens` is the
 * total including cached and cache-written tokens. An agent that does not report a field leaves it 0
 * (`reasoningTokens` unset).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens?: number;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Reads a stored `usage` payload back; undefined when it does not have the shape. */
export function usageFromPayload(v: unknown): TokenUsage | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const u = v as Record<string, unknown>;
  if (typeof u.inputTokens !== "number" || typeof u.outputTokens !== "number") return undefined;
  return {
    inputTokens: count(u.inputTokens),
    outputTokens: count(u.outputTokens),
    cacheReadInputTokens: count(u.cacheReadInputTokens),
    cacheWriteInputTokens: count(u.cacheWriteInputTokens),
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
  };
}
