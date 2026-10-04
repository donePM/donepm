import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { databaseBytes, serviceKind } from "./info.js";

describe("databaseBytes", () => {
  it("adds the WAL and shared-memory files, missing ones count 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "donepm-info-"));
    const db = join(dir, "donepm.db");
    writeFileSync(db, "x".repeat(100));
    writeFileSync(`${db}-wal`, "x".repeat(20));
    expect(databaseBytes(db)).toBe(120);
    expect(databaseBytes(join(dir, "nope.db"))).toBe(0);
  });
});

describe("serviceKind", () => {
  it("is launchd only when launchd started our job", () => {
    expect(serviceKind({ XPC_SERVICE_NAME: "com.donepm.daemon" })).toBe("launchd");
    expect(serviceKind({ XPC_SERVICE_NAME: "application.com.apple.Terminal.123" })).toBe("manual");
    expect(serviceKind({})).toBe("manual");
  });
});
