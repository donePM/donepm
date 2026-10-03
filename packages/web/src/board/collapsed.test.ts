import { describe, expect, it } from "vitest";
import { COLLAPSED_KEY, loadCollapsed, saveCollapsed, toggleCollapsed, type KeyValueStore } from "./collapsed";

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

describe("loadCollapsed", () => {
  it("defaults to all expanded", () => expect(loadCollapsed(fakeStore())).toEqual(new Set()));
  it("reads the saved keys", () => expect(loadCollapsed(fakeStore('["a","b"]'))).toEqual(new Set(["a", "b"])));
  it.each(["not json", "{}", '"a"', "[1]", '["a",null]', "null"])("treats %s as nothing collapsed", (raw) =>
    expect(loadCollapsed(fakeStore(raw))).toEqual(new Set()),
  );
  it("survives storage that throws", () => expect(loadCollapsed(throwing)).toEqual(new Set()));
  it("survives having no storage", () => expect(loadCollapsed(undefined)).toEqual(new Set()));
});

describe("saveCollapsed", () => {
  it("round-trips through the store", () => {
    const store = fakeStore();
    saveCollapsed(new Set(["a", "b"]), store);
    expect(JSON.parse(store.value!)).toEqual(["a", "b"]);
    expect(loadCollapsed(store)).toEqual(new Set(["a", "b"]));
  });
  it("uses the documented key", () => {
    const keys: string[] = [];
    saveCollapsed(new Set(), { getItem: () => null, setItem: (k) => void keys.push(k) });
    expect(keys).toEqual([COLLAPSED_KEY]);
    expect(COLLAPSED_KEY).toBe("donepm.board.collapsed");
  });
  it("survives storage that throws", () => expect(() => saveCollapsed(new Set(["a"]), throwing)).not.toThrow());
});

describe("toggleCollapsed", () => {
  it("collapses and expands without touching the input", () => {
    const start = new Set(["a"]);
    const both = toggleCollapsed(start, "b");
    expect(both).toEqual(new Set(["a", "b"]));
    expect(toggleCollapsed(both, "a")).toEqual(new Set(["b"]));
    expect(start).toEqual(new Set(["a"]));
  });
});
