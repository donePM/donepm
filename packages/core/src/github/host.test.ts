import { describe, expect, it } from "vitest";
import { hostOfOrigin, hostOfUrl, qualifiedRepository } from "./host.js";

describe("hostOfUrl", () => {
  it("is the lower-case host", () => {
    expect(hostOfUrl("https://GitHub.Acme.com/team/app/issues/1")).toBe("github.acme.com");
    expect(hostOfUrl("https://acme.ghe.com/team/app")).toBe("acme.ghe.com");
  });

  it("is undefined for anything else", () => {
    expect(hostOfUrl("team/app")).toBeUndefined();
  });
});

describe("hostOfOrigin", () => {
  it("is the first segment", () => {
    expect(hostOfOrigin("github.acme.com/team/app")).toBe("github.acme.com");
  });
});

describe("qualifiedRepository", () => {
  it("keeps github.com short and names any other host", () => {
    expect(qualifiedRepository("github.com", "o/r")).toBe("o/r");
    expect(qualifiedRepository(undefined, "o/r")).toBe("o/r");
    expect(qualifiedRepository("github.acme.com", "team/app")).toBe("github.acme.com/team/app");
  });
});
