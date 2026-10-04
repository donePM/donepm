import { ref } from "vue";
import { api } from "../api/client";
import { upsert } from "../board/items";

/** Items with a start, stop, resume or remove request in flight, so buttons can show it. */
export const pending = ref(new Set<string>());

async function run(id: string, call: (id: string) => Promise<Parameters<typeof upsert>[0]>): Promise<void> {
  pending.value = new Set(pending.value).add(id);
  try {
    upsert(await call(id));
  } finally {
    const next = new Set(pending.value);
    next.delete(id);
    pending.value = next;
  }
}

/** Throws ApiError, e.g. when the agent limit is reached. */
export const startAgent = (id: string) => run(id, api.start);
export const stopAgent = (id: string) => run(id, api.stop);
export const resumeAgent = (id: string) => run(id, api.resume);
export const removeWorktree = (id: string) => run(id, api.removeWorktree);
/** Moves an item whose issue was closed upstream to Done (D32). The worktree stays. */
export const dismissItem = (id: string) => run(id, api.dismiss);
/** Red CI (D35): rerun the failed jobs, let the agent fix it, or call it done anyway. */
export const rerunCi = (id: string) => run(id, api.rerunCi);
export const fixCi = (id: string) => run(id, api.fixCi);
export const markCiDone = (id: string) => run(id, api.markCiDone);
/** A PR that conflicts with its base (D36): let the agent merge it, or take it on yourself. */
export const resolveConflict = (id: string) => run(id, api.resolveConflict);
export const dismissConflict = (id: string) => run(id, api.dismissConflict);
