import { ref } from "vue";
import { effectiveTheme, loadTheme, nextTheme, saveTheme, type ThemeChoice } from "./theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The viewer's choice, shared by the switch and whatever else wants to know. */
export const themeChoice = ref<ThemeChoice>(loadTheme());

function prefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
}

/** Sets `dark` on <html>; theme.css switches the tokens and `color-scheme` on it. */
function apply(): void {
  const dark = effectiveTheme(themeChoice.value, prefersDark()) === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the stored choice and follows OS changes live while the choice is `system`. */
export function watchTheme(): void {
  apply();
  if (typeof matchMedia === "function") matchMedia(DARK_QUERY).addEventListener("change", apply);
}

/** One click on the switch: system → light → dark → system, remembered per browser. */
export function cycleTheme(): void {
  themeChoice.value = nextTheme(themeChoice.value);
  saveTheme(themeChoice.value);
  apply();
}
