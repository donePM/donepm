import { onScopeDispose, ref, watch, type Ref } from "vue";
import { api } from "../api/client";
import type { PermissionAsk } from "../api/types";
import { onPush, onReconnect } from "../live/socket";

/** The item's permission asks, reloaded whenever the daemon pushes an update for it. */
export function useAsks(id: Ref<string | undefined>) {
  const asks = ref<PermissionAsk[]>([]);

  let seq = 0;
  async function reload(): Promise<void> {
    const mine = ++seq;
    const itemId = id.value;
    if (!itemId) {
      asks.value = [];
      return;
    }
    try {
      const next = (await api.item(itemId)).asks;
      if (mine === seq) asks.value = next;
    } catch {
      // The transcript still shows the asks; only answering from here waits for the next push.
    }
  }

  watch(id, () => {
    asks.value = [];
    void reload();
  }, { immediate: true });

  const offPush = onPush((msg) => {
    if (msg.type === "item.updated" && (msg.payload as { id?: string }).id === id.value) void reload();
  });
  const offReconnect = onReconnect(() => void reload());
  onScopeDispose(() => {
    offPush();
    offReconnect();
  });

  return asks;
}
