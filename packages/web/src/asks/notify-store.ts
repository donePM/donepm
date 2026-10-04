import { NOTIFIED_LIMIT, rememberNotified } from "./notify";

/**
 * Per browser, like the collapsed lanes: the browser's notification permission is per browser too,
 * so the switch lives next to it and not in the daemon's config.
 */
export const NOTIFY_ENABLED_KEY = "donepm.notify.enabled";
export const NOTIFIED_KEY = "donepm.notify.notified";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): KeyValueStore | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** On unless the user switched it off. */
export function loadEnabled(store: KeyValueStore | undefined = browserStore()): boolean {
  try {
    return store?.getItem(NOTIFY_ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveEnabled(on: boolean, store: KeyValueStore | undefined = browserStore()): void {
  try {
    store?.setItem(NOTIFY_ENABLED_KEY, on ? "on" : "off");
  } catch {
    // The switch still holds for this page view.
  }
}

/** Ask ids announced before, surviving reloads. Unreadable or malformed storage means none. */
export function loadNotified(store: KeyValueStore | undefined = browserStore()): string[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(NOTIFIED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(-NOTIFIED_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Adds `ids` and returns the stored list. */
export function saveNotified(known: readonly string[], ids: readonly string[], store: KeyValueStore | undefined = browserStore()): string[] {
  const next = rememberNotified(known, ids);
  try {
    store?.setItem(NOTIFIED_KEY, JSON.stringify(next));
  } catch {
    // Worst case an ask is announced again after a reload.
  }
  return next;
}
