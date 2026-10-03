import { ref } from "vue";
import { api } from "../api/client";
import { upsert } from "../board/items";

/** Items with a start or stop request in flight, so buttons can show it. */
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
