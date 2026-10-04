import { describe, expect, it } from "vitest";
import { allowedPlaybooks, ingestOf, initialPlaybook } from "./allowed.js";

const available = [
  { name: "review", readOnly: true },
  { name: "implement" },
  { name: "fix" },
  { name: "audit", readOnly: true },
];

describe("ingestOf", () => {
  it("tells issues from pull requests", () => {
    expect(ingestOf("github-issue")).toBe("issue");
    expect(ingestOf("github-pr")).toBe("pr");
  });
});

describe("allowedPlaybooks (#153)", () => {
  it("offers issues every playbook that is not read-only by default", () => {
    expect(allowedPlaybooks("github-issue", undefined, available)).toEqual(["fix", "implement"]);
    expect(allowedPlaybooks("github-issue", { pr: ["audit"] }, available)).toEqual(["fix", "implement"]);
  });

  it("offers pull requests only review by default", () => {
    expect(allowedPlaybooks("github-pr", undefined, available)).toEqual(["review"]);
    expect(allowedPlaybooks("github-pr", { issue: ["fix"] }, available)).toEqual(["review"]);
  });

  it("follows the repository's choice, limited to playbooks that exist", () => {
    expect(allowedPlaybooks("github-issue", { issue: ["implement", "gone"] }, available)).toEqual(["implement"]);
    expect(allowedPlaybooks("github-issue", { issue: ["audit", "fix"] }, available)).toEqual(["audit", "fix"]);
    expect(allowedPlaybooks("github-pr", { pr: ["audit", "review"] }, available)).toEqual(["audit", "review"]);
  });

  it("never offers a pull request a playbook that writes (D47)", () => {
    expect(allowedPlaybooks("github-pr", { pr: ["implement", "audit"] }, available)).toEqual(["audit"]);
  });

  it("dedupes names and offers nothing when nothing is loaded", () => {
    expect(allowedPlaybooks("github-issue", undefined, [{ name: "fix" }, { name: "fix" }])).toEqual(["fix"]);
    expect(allowedPlaybooks("github-issue", undefined, [])).toEqual([]);
  });
});

describe("initialPlaybook (#153)", () => {
  it("takes the repository's default for issues when it is allowed", () => {
    expect(initialPlaybook("github-issue", "fix", ["fix", "implement"])).toBe("fix");
    expect(initialPlaybook("github-issue", "audit", ["fix", "implement"])).toBe("implement");
    expect(initialPlaybook("github-issue", undefined, ["fix", "implement"])).toBe("implement");
  });

  it("falls back to the first allowed playbook when the built-in default is not offered", () => {
    expect(initialPlaybook("github-issue", undefined, ["fix", "zap"])).toBe("fix");
    expect(initialPlaybook("github-pr", undefined, ["audit"])).toBe("audit");
  });

  it("ignores the issue default for pull requests", () => {
    expect(initialPlaybook("github-pr", "fix", ["audit", "review"])).toBe("review");
  });

  it("keeps the preference while no playbooks are known", () => {
    expect(initialPlaybook("github-issue", "fix", [])).toBe("fix");
    expect(initialPlaybook("github-issue", undefined, [])).toBe("implement");
    expect(initialPlaybook("github-pr", undefined, [])).toBe("review");
  });
});
