import { ref } from "vue";
import { api } from "../api/client";
import type { Status } from "../api/types";
import { onPush, onReconnect } from "../live/socket";

/** Daemon status shared by the top bar and Settings; kept current by `status.changed` pushes. */
export const status = ref<Status>();

let started = false;
export function watchStatus(): void {
  if (started) return;
  started = true;
  const load = () => api.status().then((s) => (status.value = s), () => undefined);
  void load();
  onPush((msg) => {
    if (msg.type === "status.changed") status.value = msg.payload as Status;
  });
  onReconnect(load);
}

export async function recheck(): Promise<void> {
  status.value = await api.recheck();
}
