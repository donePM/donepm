import { describe, expect, it } from "vitest";
import { FrontmatterError, splitFrontmatter } from "./split.js";

describe("splitFrontmatter", () => {
  it("splits and handles CRLF", () => {
    expect(splitFrontmatter("---\r\na: 1\r\n---\r\nBody\r\n")).toEqual({ frontmatter: "a: 1", body: "Body\n" });
  });
  it("throws without opening", () => expect(() => splitFrontmatter("a: 1\n---\n")).toThrow(FrontmatterError));
  it("throws without closing", () => expect(() => splitFrontmatter("---\na: 1\n")).toThrow(/closing/));
});
