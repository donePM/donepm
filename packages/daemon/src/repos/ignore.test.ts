import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.js";
import { hiddenByIgnore, ignoreChanges, ignoredOrigins, isIgnored, withIgnored } from "./ignore.js";

const sources: Config["sources"] = {
  "github.com/a/b": { query: "label:x", assignOnStart: true },
  "github.com/c/d": { assignOnStart: false, ignored: true },
  "github.com/e/f": { assignOnStart: false, ignored: false },
};

describe("isIgnored", () => {
  it("is true only for an origin flagged ignored", () => {
    expect(isIgnored(sources, "github.com/c/d")).toBe(true);
    expect(isIgnored(sources, "github.com/e/f")).toBe(false);
    expect(isIgnored(sources, "github.com/a/b")).toBe(false);
    expect(isIgnored(sources, "github.com/none/here")).toBe(false);
    expect([...ignoredOrigins(sources)]).toEqual(["github.com/c/d"]);
  });
});

describe("withIgnored", () => {
  it("sets the flag on one origin and leaves the others and its other fields alone", () => {
    expect(withIgnored(sources, "github.com/a/b", true)).toEqual({
      ...sources,
      "github.com/a/b": { query: "label:x", assignOnStart: true, ignored: true },
    });
    expect(withIgnored({}, "github.com/n/m", true)).toEqual({ "github.com/n/m": { assignOnStart: false, ignored: true } });
  });

  it("clears the flag, and drops an entry that holds nothing else", () => {
    const withQuery = withIgnored({ "github.com/a/b": { query: "q", assignOnStart: false, ignored: true } }, "github.com/a/b", false);
    expect(withQuery).toEqual({ "github.com/a/b": { query: "q", assignOnStart: false } });
    expect(withIgnored(sources, "github.com/c/d", false)).toEqual({
      "github.com/a/b": sources["github.com/a/b"],
      "github.com/e/f": sources["github.com/e/f"],
    });
    expect(withIgnored({}, "github.com/n/m", false)).toEqual({});
  });
});

describe("ignoreChanges", () => {
  it("lists the origins whose flag differs", () => {
    const next = withIgnored(withIgnored(sources, "github.com/c/d", false), "github.com/a/b", true);
    expect(ignoreChanges(sources, next).sort()).toEqual(["github.com/a/b", "github.com/c/d"]);
    expect(ignoreChanges(sources, sources)).toEqual([]);
  });
});

describe("hiddenByIgnore", () => {
  const never = () => false;

  it("never hides items of a repository that is not ignored, and does not look for pending work", () => {
    const hasPending = () => {
      throw new Error("not needed");
    };
    expect(hiddenByIgnore({ ignored: false, state: "ready", hasPending })).toBe(false);
  });

  it("hides the items of an ignored repository that need nothing", () => {
    for (const state of ["ready", "checking", "done", "failed"] as const) {
      expect(hiddenByIgnore({ ignored: true, state, hasPending: never })).toBe(true);
    }
  });

  it("keeps running and needs_you items on the board", () => {
    for (const state of ["running", "needs_you"] as const) {
      expect(hiddenByIgnore({ ignored: true, state, hasPending: never })).toBe(false);
    }
  });

  it("keeps an item with a pending draft or ask, whatever its state", () => {
    expect(hiddenByIgnore({ ignored: true, state: "checking", hasPending: () => true })).toBe(false);
  });
});
