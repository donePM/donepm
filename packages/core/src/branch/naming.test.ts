import { describe, expect, it } from "vitest";
import { branchName, slugify } from "./naming.js";

describe("slugify", () => {
  it("lowercases and dashes", () => expect(slugify("Fix  the Login_Bug!")).toBe("fix-the-login-bug"));
  it("transliterates umlauts", () => expect(slugify("Größe ändern für Übung")).toBe("groesse-aendern-fuer-uebung"));
  it("strips accents", () => expect(slugify("Café résumé")).toBe("cafe-resume"));
  it("returns empty for symbols only", () => expect(slugify("!!! ???")).toBe(""));
  it("drops non-latin", () => expect(slugify("日本語 title")).toBe("title"));
});

describe("branchName", () => {
  const base = { prefix: "dp/", issueNumber: 12 };

  it("builds prefix, number, slug", () => {
    expect(branchName({ ...base, title: "Add dark mode" })).toBe("dp/12-add-dark-mode");
  });
  it("handles umlauts", () => {
    expect(branchName({ ...base, title: "Übergröße prüfen" })).toBe("dp/12-uebergroesse-pruefen");
  });
  it("supports an empty prefix", () => {
    expect(branchName({ prefix: "", issueNumber: 3, title: "x" })).toBe("3-x");
  });
  it("omits the slug when the title has no usable chars", () => {
    expect(branchName({ ...base, title: "???" })).toBe("dp/12");
  });
  it("caps at 60 chars without a trailing dash", () => {
    const name = branchName({ ...base, title: "A very long title that goes on and on and on and on forever and ever amen" });
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.startsWith("dp/12-a-very-long-title")).toBe(true);
    expect(name.endsWith("-")).toBe(false);
  });
  it("does not leave a trailing dash when the cut falls on a separator", () => {
    const title = "x".repeat(50) + " tail"; // head "dp/12" (5) + "-" + 54 slug room
    const name = branchName({ ...base, title: "x".repeat(53) + " tail" });
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith("-")).toBe(false);
    expect(title).toBeTruthy();
  });
  it("appends -2, -3 on collision", () => {
    const first = branchName({ ...base, title: "Add dark mode" });
    const second = branchName({ ...base, title: "Add dark mode", existing: [first] });
    const third = branchName({ ...base, title: "Add dark mode", existing: [first, second] });
    expect([second, third]).toEqual(["dp/12-add-dark-mode-2", "dp/12-add-dark-mode-3"]);
  });
  it("keeps the 60 char limit when a suffix is needed", () => {
    const title = "word ".repeat(30);
    const first = branchName({ ...base, title });
    expect(first.length).toBe(60);
    const second = branchName({ ...base, title, existing: [first] });
    expect(second.length).toBeLessThanOrEqual(60);
    expect(second.endsWith("-2")).toBe(true);
    expect(second).not.toBe(first);
  });
  it("accepts a Set of existing branches", () => {
    expect(branchName({ ...base, title: "a", existing: new Set(["dp/12-a"]) })).toBe("dp/12-a-2");
  });
});
