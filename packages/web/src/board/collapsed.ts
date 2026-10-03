/** Which lanes the user collapsed, remembered across reloads. Default is all expanded. */
export const COLLAPSED_KEY = "donepm.board.collapsed";

/** The part of `Storage` we use, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** Reading `localStorage` itself can throw (blocked storage), hence the guard. */
function browserStore(): KeyValueStore | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Lane keys saved earlier. Missing, unreadable or malformed storage means nothing is collapsed. */
export function loadCollapsed(store: KeyValueStore | undefined = browserStore()): Set<string> {
  try {
    const raw = store?.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === "string")) return new Set();
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

/** Best effort: a full or blocked storage must not break the board. */
export function saveCollapsed(keys: ReadonlySet<string>, store: KeyValueStore | undefined = browserStore()): void {
  try {
    store?.setItem(COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    // The lane still collapses for this page view.
  }
}

/** A new set with `key` flipped. */
export function toggleCollapsed(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}
