/**
 * Token usage with the names of the Laravel AI SDK (`TextUsage`). As there, `inputTokens` is the
 * total including cached and cache-written tokens. `reasoningTokens` is never reported by Claude
 * Code and stays unset.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens?: number;
}

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
