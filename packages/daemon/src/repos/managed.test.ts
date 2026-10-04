import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.js";
import { hiddenUnmanaged, isManaged, itemManaged, managedChanges, managedOrigins, migrateManaged, withManaged } from "./managed.js";

const sources: Config["sources"] = {
  "github.com/a/b": { query: "label:x", assignOnStart: true, managed: true },
  "github.com/c/d": { assignOnStart: false, managed: false },
  "github.com/e/f": { assignOnStart: false },
};

describe("isManaged", () => {
  it("is true only for an origin flagged managed", () => {
    expect(isManaged(sources, "github.com/a/b")).toBe(true);
    expect(isManaged(sources, "github.com/c/d")).toBe(false);
    expect(isManaged(sources, "github.com/e/f")).toBe(false);
    expect(isManaged(sources, "github.com/none/here")).toBe(false);
    expect([...managedOrigins(sources)]).toEqual(["github.com/a/b"]);
  });
});

describe("itemManaged (issue #139)", () => {
  it("goes by the item's origin, or a ticket's candidates until one is chosen", () => {
    expect(itemManaged(sources, {}, "github.com/a/b")).toBe(true);
    expect(itemManaged(sources, { repoCandidates: ["github.com/a/b", "github.com/c/d"] }, "github.com/c/d")).toBe(false);
    expect(itemManaged(sources, { repoCandidates: ["github.com/c/d", "github.com/a/b"] }, "")).toBe(true);
    expect(itemManaged(sources, { repoCandidates: ["github.com/c/d"] }, "")).toBe(false);
  });
});

describe("withManaged", () => {
  it("sets the flag on one origin and leaves the others and its other fields alone", () => {
    expect(withManaged(sources, "github.com/c/d", true)).toEqual({
      ...sources,
      "github.com/c/d": { assignOnStart: false, managed: true },
    });
    expect(withManaged({}, "github.com/n/m", true)).toEqual({ "github.com/n/m": { assignOnStart: false, managed: true } });
  });

  it("keeps an unmanaged entry with an explicit false, and drops the old ignored flag", () => {
    expect(withManaged(sources, "github.com/a/b", false)["github.com/a/b"]).toEqual({ query: "label:x", assignOnStart: true, managed: false });
    expect(withManaged({ "github.com/n/m": { assignOnStart: false, ignored: true } }, "github.com/n/m", false)).toEqual({
      "github.com/n/m": { assignOnStart: false, managed: false },
    });
  });
});

describe("managedChanges", () => {
  it("lists the origins whose flag differs", () => {
    const next = withManaged(withManaged(sources, "github.com/c/d", true), "github.com/a/b", false);
    expect(managedChanges(sources, next).sort()).toEqual(["github.com/a/b", "github.com/c/d"]);
    expect(managedChanges(sources, withManaged(sources, "github.com/e/f", false))).toEqual([]);
  });
});

describe("migrateManaged", () => {
  it("manages origins with items or settings, and unmanages ignored ones", () => {
    const old: Config["sources"] = {
      "github.com/a/b": { query: "q", assignOnStart: true },
      "github.com/c/d": { assignOnStart: false, ignored: true },
    };
    expect(migrateManaged(old, ["github.com/x/y", "github.com/c/d"])).toEqual({
      "github.com/x/y": { assignOnStart: false, managed: true },
      "github.com/a/b": { query: "q", assignOnStart: true, managed: true },
      "github.com/c/d": { assignOnStart: false, managed: false },
    });
  });

  it("leaves a config alone that has the flag already, even with nothing managed", () => {
    const unmanagedAll = withManaged({}, "github.com/a/b", false);
    expect(migrateManaged(unmanagedAll, ["github.com/a/b", "github.com/x/y"])).toBeUndefined();
  });

  it("has nothing to do on a fresh install", () => {
    expect(migrateManaged({}, [])).toBeUndefined();
  });
});

describe("hiddenUnmanaged", () => {
  const never = () => false;

  it("never hides items of a managed repository, and does not look for pending work", () => {
    const hasPending = () => {
      throw new Error("not needed");
    };
    expect(hiddenUnmanaged({ managed: true, state: "ready", hasPending })).toBe(false);
  });

  it("hides the items of an unmanaged repository that need nothing", () => {
    for (const state of ["ready", "checking", "done", "failed"] as const) {
      expect(hiddenUnmanaged({ managed: false, state, hasPending: never })).toBe(true);
    }
  });

  it("keeps running and needs_you items on the board", () => {
    for (const state of ["running", "needs_you"] as const) {
      expect(hiddenUnmanaged({ managed: false, state, hasPending: never })).toBe(false);
    }
  });

  it("keeps an item with a pending draft or ask, whatever its state", () => {
    expect(hiddenUnmanaged({ managed: false, state: "checking", hasPending: () => true })).toBe(false);
  });
});
