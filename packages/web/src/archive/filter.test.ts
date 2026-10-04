import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { isFinished } from "../board/finished";
import { filterArchive } from "./filter";

function item(id: string, title: string, archivedAt?: string): ItemView {
  return {
    id, source: "github-issue", externalId: `acme/widgets#${id}`, externalUrl: `https://github.com/acme/widgets/issues/${id}`,
    title, body: "", labels: [], state: "done", playbook: "implement", priority: 2,
    stateSince: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    repo: null, badges: [], agent: { running: false }, ...(archivedAt ? { archivedAt } : {}),
  };
}

const list = [
  item("1", "Fix login redirect", "2026-10-02T00:00:00Z"),
  item("2", "Add CSV export", "2026-10-03T00:00:00Z"),
  item("12", "Login page copy", "2026-10-01T00:00:00Z"),
];

describe("filterArchive", () => {
  it("lists newest archived first", () => {
    expect(filterArchive(list, "").map((i) => i.id)).toEqual(["2", "1", "12"]);
  });

  it("searches title and external id, ignoring case; every word must match", () => {
    expect(filterArchive(list, "LOGIN").map((i) => i.id)).toEqual(["1", "12"]);
    expect(filterArchive(list, "widgets#12").map((i) => i.id)).toEqual(["12"]);
    expect(filterArchive(list, "login copy").map((i) => i.id)).toEqual(["12"]);
    expect(filterArchive(list, "nothing")).toEqual([]);
  });

  it("does not reorder the list it was given", () => {
    const before = list.map((i) => i.id);
    filterArchive(list, "");
    expect(list.map((i) => i.id)).toEqual(before);
  });
});

describe("isFinished", () => {
  it("is a done item the daemon reports finished", () => {
    expect(isFinished({ state: "done", finishedAt: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(isFinished({ state: "done" })).toBe(false);
    expect(isFinished({ state: "checking", finishedAt: "2026-10-01T00:00:00Z" })).toBe(false);
  });
});
