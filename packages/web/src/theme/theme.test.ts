import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveTheme, loadTheme, nextTheme, parseTheme, saveTheme, THEME_KEY, themeLabel, type KeyValueStore } from "./theme";

function fakeStore(initial?: string): KeyValueStore & { value?: string } {
  const store: KeyValueStore & { value?: string } = {
    value: initial,
    getItem: () => store.value ?? null,
    setItem: (_k, v) => void (store.value = v),
  };
  return store;
}

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

describe("nextTheme", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});

describe("effectiveTheme", () => {
  it("follows the OS in system mode", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
  });
  it("ignores the OS for an explicit choice", () => {
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });
});

describe("themeLabel", () => {
  it("names the current state and the next one", () => {
    expect(themeLabel("system")).toBe("Theme: system. Switch to light");
    expect(themeLabel("light")).toBe("Theme: light. Switch to dark");
    expect(themeLabel("dark")).toBe("Theme: dark. Switch to system");
  });
});

describe("parseTheme", () => {
  it.each([null, undefined, "", "auto", "Dark", "true"])("treats %s as system", (raw) => expect(parseTheme(raw)).toBe("system"));
});

describe("loadTheme and saveTheme", () => {
  it("defaults to system", () => expect(loadTheme(fakeStore())).toBe("system"));
  it.each(["system", "light", "dark"] as const)("round-trips %s", (choice) => {
    const store = fakeStore();
    saveTheme(choice, store);
    expect(store.value).toBe(choice);
    expect(loadTheme(store)).toBe(choice);
  });
  it("falls back to system on an unknown stored value", () => expect(loadTheme(fakeStore("sepia"))).toBe("system"));
  it("uses the key index.html reads", () => {
    const keys: string[] = [];
    saveTheme("dark", { getItem: () => null, setItem: (k) => void keys.push(k) });
    expect(keys).toEqual([THEME_KEY]);
    expect(THEME_KEY).toBe("donepm.theme");
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html).toContain(`localStorage.getItem("${THEME_KEY}")`);
  });
  it("survives storage that throws", () => {
    expect(loadTheme(throwing)).toBe("system");
    expect(() => saveTheme("dark", throwing)).not.toThrow();
  });
  it("survives having no storage", () => expect(loadTheme(undefined)).toBe("system"));
});
