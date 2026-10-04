import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { asksToNotify, askSummary, faviconSvg, NOTIFIED_LIMIT, pendingAsks, rememberNotified, tabTitle } from "./notify";
import { loadEnabled, loadNotified, saveEnabled, saveNotified, type KeyValueStore } from "./notify-store";

const item = (id: string, attention?: ItemView["attention"]): ItemView =>
  ({ id, title: `Item ${id}`, state: "needs_you", ...(attention ? { attention } : {}) }) as ItemView;
const ask = (askId: string, toolName = "Bash", input: unknown = { command: "pnpm test" }): ItemView["attention"] => ({
  kind: "ask", askId, toolName, input, rules: [],
});

describe("pendingAsks", () => {
  it("lists only items waiting on an ask, with title and summary", () => {
    const list = pendingAsks([
      item("a", ask("k1")),
      item("b", { kind: "resume", reason: "x" }),
      item("c"),
    ]);
    expect(list).toEqual([{ askId: "k1", itemId: "a", title: "Item a", summary: "Bash: pnpm test" }]);
  });
});

describe("askSummary", () => {
  it("uses the first line of the command, the URL, or just the tool", () => {
    expect(askSummary("Bash", { command: "echo a\necho b" })).toBe("Bash: echo a");
    expect(askSummary("WebFetch", { url: "https://x.dev/a" })).toBe("WebFetch: https://x.dev/a");
    expect(askSummary("mcp__x__y", { a: 1 })).toBe("mcp__x__y");
  });
  it("cuts long lines", () => {
    expect(askSummary("Bash", { command: "x".repeat(300) }).length).toBeLessThan(140);
  });
});

describe("asksToNotify", () => {
  const pending = [
    { askId: "k1", itemId: "a", title: "A", summary: "s" },
    { askId: "k2", itemId: "b", title: "B", summary: "s" },
  ];
  const on = { enabled: true, permission: "granted" as const };
  it("announces asks not announced before", () => {
    expect(asksToNotify(pending, new Set(["k1"]), on).map((a) => a.askId)).toEqual(["k2"]);
  });
  it("announces nothing when switched off or not permitted", () => {
    expect(asksToNotify(pending, new Set(), { ...on, enabled: false })).toEqual([]);
    for (const permission of ["denied", "default", "unsupported"] as const) {
      expect(asksToNotify(pending, new Set(), { enabled: true, permission })).toEqual([]);
    }
  });
});

describe("rememberNotified", () => {
  it("keeps the newest ids within the limit", () => {
    expect(rememberNotified(["a", "b", "c"], ["d"], 3)).toEqual(["b", "c", "d"]);
    expect(rememberNotified(["a"], ["a", "b"], 5)).toEqual(["a", "b"]);
    const many = Array.from({ length: NOTIFIED_LIMIT + 50 }, (_, i) => `k${i}`);
    expect(rememberNotified([], many)).toHaveLength(NOTIFIED_LIMIT);
  });
});

describe("tabTitle and favicon", () => {
  it("shows the count only while asks wait", () => {
    expect(tabTitle("donePM", 0)).toBe("donePM");
    expect(tabTitle("donePM", 2)).toBe("(2) donePM");
  });
  it("adds a dot only when asked", () => {
    expect(faviconSvg(true)).toContain("#dc2626");
    expect(faviconSvg(false)).not.toContain("#dc2626");
  });
});

function fakeStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("notify store", () => {
  it("is on by default and remembers off", () => {
    const store = fakeStore();
    expect(loadEnabled(store)).toBe(true);
    saveEnabled(false, store);
    expect(loadEnabled(store)).toBe(false);
  });
  it("keeps announced ids across loads, bounded", () => {
    const store = fakeStore();
    const known = saveNotified([], ["a", "b"], store);
    saveNotified(known, ["c"], store);
    expect(loadNotified(store)).toEqual(["a", "b", "c"]);
  });
  it("survives malformed or throwing storage", () => {
    expect(loadNotified(fakeStore({ "donepm.notify.notified": "{oops" }))).toEqual([]);
    const broken: KeyValueStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadNotified(broken)).toEqual([]);
    expect(loadEnabled(broken)).toBe(true);
    expect(() => saveNotified([], ["a"], broken)).not.toThrow();
  });
});
