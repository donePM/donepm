import { onScopeDispose, ref, watch, type Ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { ItemDetail, ItemDiff } from "../api/types";
import { onPush, onReconnect } from "../live/socket";

/**
 * The item with events, drafts and asks, reloaded whenever the daemon pushes an update for it.
 * The diff loads separately: it runs git, so it reloads on state changes and on request only.
 */
export function useItemDetail(id: Ref<string>) {
  const detail = ref<ItemDetail>();
  const error = ref<string>();
  const diff = ref<ItemDiff>();
  const diffError = ref<string>();
  const diffLoading = ref(false);

  let seq = 0;
  async function reload(): Promise<void> {
    const mine = ++seq;
    try {
      const next = await api.item(id.value);
      if (mine !== seq) return;
      const stateChanged = detail.value?.id !== next.id || detail.value.state !== next.state;
      detail.value = next;
      error.value = undefined;
      if (stateChanged) void reloadDiff();
    } catch (e) {
      if (mine === seq) error.value = errorText(e);
    }
  }

  let diffSeq = 0;
  async function reloadDiff(): Promise<void> {
    const item = detail.value;
    if (!item?.worktreePath) {
      diff.value = undefined;
      return;
    }
    const mine = ++diffSeq;
    diffLoading.value = true;
    try {
      const next = await api.diff(item.id);
      if (mine !== diffSeq) return;
      diff.value = next;
      diffError.value = undefined;
    } catch (e) {
      if (mine === diffSeq) diffError.value = errorText(e);
    } finally {
      if (mine === diffSeq) diffLoading.value = false;
    }
  }

  watch(id, () => {
    detail.value = undefined;
    diff.value = undefined;
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

  return { detail, error, diff, diffError, diffLoading, reload, reloadDiff };
}
