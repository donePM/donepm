import { onScopeDispose, ref, watch, type Ref } from "vue";
import { api } from "../api/client";
import type { TranscriptMessage } from "../api/types";
import { onPush, onReconnect } from "../live/socket";
import { applyDelta } from "./rows";

/**
 * The transcript of one item, kept live: loads what is stored, appends pushed messages, and
 * follows the text the agent is typing. After a reconnect it loads what it missed.
 */
export function useTranscript(itemId: Ref<string | undefined>) {
  const messages = ref<TranscriptMessage[]>([]);
  const live = ref("");
  const error = ref<string>();
  const loading = ref(false);
  let loadedFor: string | undefined;

  const append = (list: readonly TranscriptMessage[]) => {
    const known = new Set(messages.value.map((m) => m.id));
    const fresh = list.filter((m) => !known.has(m.id));
    if (fresh.length) messages.value = [...messages.value, ...fresh];
  };

  /** The API returns pages; keep reading until one comes back empty. */
  const load = async (id: string, after?: string) => {
    loading.value = !after;
    try {
      let cursor = after;
      for (;;) {
        const list = await api.transcript(id, cursor);
        if (itemId.value !== id) return;
        if (!list.length) break;
        append(list);
        cursor = list.at(-1)!.id;
      }
      error.value = undefined;
    } catch (e) {
      if (itemId.value === id) error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (itemId.value === id) loading.value = false;
    }
  };

  watch(
    itemId,
    (id) => {
      messages.value = [];
      live.value = "";
      loadedFor = id;
      if (id) void load(id);
    },
    { immediate: true },
  );

  const offPush = onPush((msg) => {
    const p = msg.payload as { itemId?: string } | undefined;
    if (!p || p.itemId !== itemId.value) return;
    if (msg.type === "transcript.appended") {
      const m = msg.payload as TranscriptMessage;
      append([m]);
      if (m.kind === "assistant_text" || m.kind === "result") live.value = "";
    } else if (msg.type === "stream.delta") {
      live.value = applyDelta(live.value, (msg.payload as { event: unknown }).event);
    }
  });
  const offReconnect = onReconnect(() => {
    if (loadedFor) void load(loadedFor, messages.value.at(-1)?.id);
  });
  onScopeDispose(() => {
    offPush();
    offReconnect();
  });

  return { messages, live, error, loading };
}
