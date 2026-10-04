import { describe, expect, it } from "vitest";
import { parseRetention, retentionInput } from "./retention";

describe("retention settings", () => {
  it("shows never-delete as an empty field and round-trips", () => {
    expect(retentionInput({ archiveAfterHours: 24, deleteAfterDays: null })).toEqual({ archiveAfterHours: "24", deleteAfterDays: "" });
    expect(parseRetention(retentionInput({ archiveAfterHours: 0, deleteAfterDays: 7 }))).toEqual({
      ok: true,
      value: { archiveAfterHours: 0, deleteAfterDays: 7 },
    });
  });

  it("maps an empty delete field to null", () => {
    expect(parseRetention({ archiveAfterHours: "24", deleteAfterDays: " " })).toEqual({
      ok: true,
      value: { archiveAfterHours: 24, deleteAfterDays: null },
    });
  });

  it("accepts only whole numbers of 0 or more", () => {
    for (const bad of ["-1", "1.5", "abc", "1e3"]) {
      expect(parseRetention({ archiveAfterHours: bad, deleteAfterDays: "7" }).ok).toBe(false);
      expect(parseRetention({ archiveAfterHours: "24", deleteAfterDays: bad }).ok).toBe(false);
    }
    expect(parseRetention({ archiveAfterHours: "", deleteAfterDays: "7" }).ok).toBe(false);
  });
});
