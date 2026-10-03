import { describe, expect, it } from "vitest";
import { makeGuard } from "./guard.js";

describe("guard", () => {
  const allowed = makeGuard(() => 6174, ["http://localhost:5173"]);

  it("allows local hosts without origin (curl, CLI)", () => {
    expect(allowed({ host: "127.0.0.1:6174" })).toBe(true);
    expect(allowed({ host: "localhost:6174" })).toBe(true);
  });

  it("allows the own UI and configured dev origins", () => {
    expect(allowed({ host: "127.0.0.1:6174", origin: "http://127.0.0.1:6174" })).toBe(true);
    expect(allowed({ host: "localhost:5173", origin: "http://localhost:5173" })).toBe(true);
  });

  it("rejects foreign hosts (DNS rebinding) and foreign origins", () => {
    expect(allowed({ host: "evil.example:6174" })).toBe(false);
    expect(allowed({})).toBe(false);
    expect(allowed({ host: "127.0.0.1:6174", origin: "https://evil.example" })).toBe(false);
    expect(allowed({ host: "127.0.0.1:6174", origin: "null" })).toBe(false);
  });
});
