import { ref } from "vue";
import { api } from "../api/client";
import type { ItemView } from "../api/types";
import { onPush, onReconnect } from "../live/socket";

export const items = ref<ItemView[]>([]);
export const itemsError = ref<string>();
export const itemsLoaded = ref(false);

let inFlight: Promise<void> | undefined;
let again = false;

/** Reload the list. A poll pushes several `item.updated` at once; those collapse into one extra load. */
export function reloadItems(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = api
    .items()
    .then(
      (list) => {
        items.value = list;
        itemsError.value = undefined;
        itemsLoaded.value = true;
      },
      (e: unknown) => {
        itemsError.value = e instanceof Error ? e.message : String(e);
      },
    )
    .finally(() => {
      inFlight = undefined;
      if (again) {
        again = false;
        void reloadItems();
      }
    });
  return inFlight;
}

/** Apply a pushed item in place; the agent's tool calls push often, a full reload each time is wasteful. */
export function upsert(item: ItemView): void {
  const i = items.value.findIndex((x) => x.id === item.id);
  if (i === -1) items.value = [...items.value, item];
  else items.value = items.value.map((x, j) => (j === i ? item : x));
}

/** The daemon took the item off the board (its repository is not managed); it is not deleted. */
export function remove(id: string): void {
  if (items.value.some((x) => x.id === id)) items.value = items.value.filter((x) => x.id !== id);
}

let started = false;
export function watchItems(): void {
  if (started) return;
  started = true;
  void reloadItems();
  onPush((msg) => {
    if (msg.type === "item.updated") upsert(msg.payload as ItemView);
    if (msg.type === "item.removed") remove((msg.payload as { id: string }).id);
  });
  onReconnect(() => void reloadItems());
}
