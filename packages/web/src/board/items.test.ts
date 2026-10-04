import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemView } from "../api/types";
import type { Push } from "../live/socket";

let push: (msg: Push) => void = () => {};
const list = vi.fn<() => Promise<ItemView[]>>();

vi.mock("../live/socket", () => ({
  onPush: (h: (msg: Push) => void) => void (push = h),
  onReconnect: () => {},
}));
vi.mock("../api/client", () => ({ api: { items: () => list() } }));

const { items, remove, upsert, watchItems } = await import("./items");

const item = (id: string, over: Partial<ItemView> = {}): ItemView => ({
  id, source: "github-issue", externalId: `o/r#${id}`, externalUrl: "", title: id, body: "", labels: [],
  state: "ready", playbook: "implement", priority: 1, stateSince: "t0", createdAt: "t0", updatedAt: "t0",
  repo: null, badges: [], agent: { running: false }, ...over,
});

beforeEach(() => {
  items.value = [];
});

describe("remove", () => {
  it("takes the item off the list and leaves the others", () => {
    items.value = [item("a"), item("b")];
    remove("a");
    expect(items.value.map((i) => i.id)).toEqual(["b"]);
  });

  it("ignores an id that is not on the board", () => {
    items.value = [item("a")];
    remove("zzz");
    expect(items.value.map((i) => i.id)).toEqual(["a"]);
  });

  it("is undone by a later upsert of the same id", () => {
    items.value = [item("a")];
    remove("a");
    upsert(item("a", { title: "back" }));
    expect(items.value.map((i) => [i.id, i.title])).toEqual([["a", "back"]]);
  });
});

describe("watchItems", () => {
  it("applies item.updated and item.removed pushes", async () => {
    list.mockResolvedValue([item("a")]);
    watchItems();
    await vi.waitFor(() => expect(items.value.map((i) => i.id)).toEqual(["a"]));

    push({ type: "item.updated", payload: item("b") });
    expect(items.value.map((i) => i.id)).toEqual(["a", "b"]);

    push({ type: "item.removed", payload: { id: "a" } });
    expect(items.value.map((i) => i.id)).toEqual(["b"]);

    push({ type: "item.updated", payload: item("a") });
    expect(items.value.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });
});
