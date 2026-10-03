import { randomUUID } from "node:crypto";
import type { Ctx } from "@donepm/core";

/** Real clock and uuid source for core functions. */
export const systemCtx: Ctx = {
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
};
