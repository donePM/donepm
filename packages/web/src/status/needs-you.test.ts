import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { needsYouCount, needsYouLabel, needsYouShort } from "./needs-you";

const item = (state: ItemView["state"], over: Partial<ItemView> = {}): ItemView => ({ id: state, state, ...over }) as ItemView;

describe("needsYouCount", () => {
  it("is zero for an empty list", () => expect(needsYouCount([])).toBe(0));
  it("counts needs_you and failed, nothing else", () => {
    const list = [item("ready"), item("running"), item("checking"), item("needs_you"), item("failed"), item("done")];
    expect(needsYouCount(list)).toBe(2);
  });
  it("skips archived items", () => {
    expect(needsYouCount([item("failed", { archivedAt: "2026-10-01T00:00:00Z" }), item("needs_you")])).toBe(1);
  });
});

describe("needsYouLabel", () => {
  it("pluralises", () => {
    expect(needsYouLabel(1)).toBe("1 item needs you");
    expect(needsYouLabel(3)).toBe("3 items need you");
  });
});

describe("needsYouShort", () => {
  it("is the pill's text", () => {
    expect(needsYouShort(1)).toBe("1 needs you");
    expect(needsYouShort(3)).toBe("3 need you");
  });
});
