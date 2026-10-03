import { ref } from "vue";
import { api } from "../api/client";
import type { Status } from "../api/types";
import { onConnection, onPush, onReconnect } from "../live/socket";

/** Daemon status shared by the top bar and Settings; kept current by `status.changed` pushes. */
export const status = ref<Status>();

/** False while the daemon cannot be reached (socket closed or a status load failed); `status` is then stale. */
export const reachable = ref(true);

let started = false;
export function watchStatus(): void {
  if (started) return;
  started = true;
  const load = () =>
    api.status().then(
      (s) => {
        status.value = s;
        reachable.value = true;
      },
      () => {
        reachable.value = false;
      },
    );
  void load();
  onPush((msg) => {
    reachable.value = true;
    if (msg.type === "status.changed") status.value = msg.payload as Status;
  });
  onConnection((open) => (reachable.value = open));
  onReconnect(load);
}

export async function recheck(): Promise<void> {
  status.value = await api.recheck();
  reachable.value = true;
}
