import { describe, expect, it } from "vitest";
import { parseConflictFiles } from "./conflict-files.js";

describe("parseConflictFiles", () => {
  it("takes the names between the tree and the messages, once each", () => {
    // As git 2.54 prints `merge-tree --write-tree --name-only -z` for two conflicting files.
    const out = "ab07f2d5b4c8d757bfde0dad5495722a6be2b463\0f.txt\0sp ace.txt\0f.txt\0\0" + "1\0f.txt\0Auto-merging\0Auto-merging f.txt\n\0";
    expect(parseConflictFiles(out)).toEqual(["f.txt", "sp ace.txt"]);
  });

  it("is empty for a tree alone", () => {
    expect(parseConflictFiles("ab07f2d5b4c8d757bfde0dad5495722a6be2b463\0")).toEqual([]);
    expect(parseConflictFiles("")).toEqual([]);
  });
});
