/**
 * The theme the viewer chose. Per browser, like the collapsed lanes: it is a viewer preference,
 * not daemon state. `system` follows the OS; `light` and `dark` ignore it.
 */
export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** index.html reads the same key before first paint; keep the two in step. */
export const THEME_KEY = "donepm.theme";

const ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];

/** The switch cycles system → light → dark → system. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
}

/** What the page shows for a choice, given whether the OS prefers dark. */
export function effectiveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

/** Anything but a known choice (missing, stale, hand-edited) means system. */
export function parseTheme(raw: string | null | undefined): ThemeChoice {
  return ORDER.includes(raw as ThemeChoice) ? (raw as ThemeChoice) : "system";
}

/** The switch's label: the current state and what a click does. */
export function themeLabel(choice: ThemeChoice): string {
  return `Theme: ${choice}. Switch to ${nextTheme(choice)}`;
}

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

export function loadTheme(store: KeyValueStore | undefined = browserStore()): ThemeChoice {
  try {
    return parseTheme(store?.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

/** Best effort: a full or blocked storage keeps the choice for this page view only. */
export function saveTheme(choice: ThemeChoice, store: KeyValueStore | undefined = browserStore()): void {
  try {
    store?.setItem(THEME_KEY, choice);
  } catch {
    // The theme still switches until the next reload.
  }
}
