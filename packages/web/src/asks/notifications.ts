import { computed, ref, watch } from "vue";
import type { Router } from "vue-router";
import { items, itemsLoaded, watchItems } from "../board/items";
import { loadEnabled, loadNotified, saveEnabled, saveNotified } from "./notify-store";
import { asksToNotify, faviconSvg, pendingAsks, tabTitle, type NotifyPermission } from "./notify";

const BASE_TITLE = "donePM";

function currentPermission(): NotifyPermission {
  try {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  } catch {
    return "unsupported";
  }
}

let known = loadNotified();

export const notifyEnabled = ref(loadEnabled());
export const notifyPermission = ref<NotifyPermission>(currentPermission());
export const pending = computed(() => pendingAsks(items.value));

export function setNotifyEnabled(on: boolean): void {
  notifyEnabled.value = on;
  saveEnabled(on);
}

/** Needs a user gesture (the Settings button). Asks already waiting are not announced afterwards. */
export async function requestNotifyPermission(): Promise<void> {
  if (notifyPermission.value === "unsupported") return;
  try {
    await Notification.requestPermission();
  } catch {
    // The permission read below is still right.
  }
  notifyPermission.value = currentPermission();
  if (notifyPermission.value === "granted") known = saveNotified(known, pending.value.map((a) => a.askId));
}

const icon: { svg?: HTMLLinkElement; ico?: HTMLLinkElement; original?: string } = {};

function setFavicon(dot: boolean): void {
  icon.svg ??= document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]') ?? undefined;
  icon.ico ??= document.querySelector<HTMLLinkElement>('link[rel="icon"][sizes="any"]') ?? undefined;
  if (!icon.svg) return;
  icon.original ??= icon.svg.getAttribute("href") ?? "/favicon.svg";
  icon.svg.setAttribute("href", dot ? `data:image/svg+xml,${encodeURIComponent(faviconSvg(true))}` : icon.original);
  // Browsers that prefer the .ico would never show the dot.
  if (icon.ico) icon.ico.disabled = dot;
}

/** Tab title, favicon dot and browser notifications for pending asks. Call once from the app shell. */
export function watchAskNotifications(router: Router): void {
  watchItems();
  watch(
    () => pending.value.length,
    (n) => {
      document.title = tabTitle(BASE_TITLE, n);
      setFavicon(n > 0);
    },
    { immediate: true },
  );
  watch(
    [pending, itemsLoaded, notifyEnabled],
    ([list, loaded]) => {
      if (!loaded) return;
      notifyPermission.value = currentPermission();
      const fresh = asksToNotify(list, new Set(known), { enabled: notifyEnabled.value, permission: notifyPermission.value });
      if (fresh.length === 0) return;
      known = saveNotified(known, fresh.map((a) => a.askId));
      for (const ask of fresh) {
        try {
          const n = new Notification(ask.title, { body: ask.summary, tag: ask.askId });
          n.onclick = () => {
            window.focus();
            void router.push({ name: "item", params: { id: ask.itemId } });
            n.close();
          };
        } catch {
          // Some browsers only allow notifications from a service worker; the title count still shows.
        }
      }
    },
    { immediate: true },
  );
}
