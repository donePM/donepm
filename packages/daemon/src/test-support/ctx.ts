import type { Ctx } from "@donepm/core";

/** Deterministic clock and ids: `id-1`, `id-2`, ... and a fixed time. */
export function testCtx(now = "2026-10-03T12:00:00.000Z"): Ctx {
  let n = 0;
  return { now: () => now, newId: () => `id-${++n}` };
}
