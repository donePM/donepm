// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown/render";
import { draftTab } from "./draft-tab";

describe("draftTab", () => {
  it("opens an untouched draft on Preview and an edited one on Write", () => {
    expect(draftTab(false)).toBe("preview");
    expect(draftTab(true)).toBe("write");
  });

  it("previews the edited body, not the stored one", () => {
    const stored = "Fixes #1";
    const edited = "Fixes #1\n\n- [x] tests";
    const repo = { owner: "acme", name: "shop" };
    expect(renderMarkdown(edited, repo)).not.toBe(renderMarkdown(stored, repo));
    expect(renderMarkdown(edited, repo)).toContain("task-list-item-checkbox");
  });
});
