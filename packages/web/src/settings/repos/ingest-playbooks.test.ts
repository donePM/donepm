import { describe, expect, it } from "vitest";
import type { PlaybookEntry, PlaybookList } from "../../api/types";
import { ingestChoices, ingestConfig, ingestSelection } from "./ingest-playbooks";

const pb = (name: string, scope: PlaybookEntry["scope"], readOnly = false): PlaybookEntry => ({
  name, model: "opus", permissionMode: "default", drafts: [], body: "", tools: [], permissions: { allow: [], deny: [] }, file: `${name}.md`, scope,
  ...(readOnly ? { readOnly } : {}),
});
const ORIGIN = "github.com/a/b";
const list: PlaybookList = {
  globalDir: "/pb",
  problems: [],
  playbooks: [
    pb("implement", { kind: "global" }),
    pb("review", { kind: "global" }, true),
    pb("audit", { kind: "repo", repoId: "r1", origin: ORIGIN, path: "/b" }, true),
    pb("fix", { kind: "repo", repoId: "r1", origin: ORIGIN, path: "/b" }),
  ],
};
const names = (c: { name: string }[]) => c.map((x) => x.name);

describe("ingestChoices (#153)", () => {
  it("offers issues every playbook and pull requests only read-only ones", () => {
    expect(names(ingestChoices(list, ORIGIN, "issue"))).toEqual(["audit", "fix", "implement", "review"]);
    expect(names(ingestChoices(list, ORIGIN, "pr"))).toEqual(["audit", "review"]);
  });

  it("keeps a configured playbook no file defines, marked", () => {
    expect(ingestChoices(list, ORIGIN, "pr", ["gone"]).at(-1)).toEqual({ name: "gone", label: "gone (not found)" });
  });
});

describe("ingestSelection (#153)", () => {
  it("is the configured list, else the default", () => {
    expect(ingestSelection(list, ORIGIN, "issue", undefined)).toEqual(["fix", "implement"]);
    expect(ingestSelection(list, ORIGIN, "pr", undefined)).toEqual(["review"]);
    expect(ingestSelection(list, ORIGIN, "pr", { pr: ["audit"] })).toEqual(["audit"]);
  });
});

describe("ingestConfig (#153)", () => {
  it("leaves out an ingest that keeps its default, and the whole entry when both do", () => {
    expect(ingestConfig(list, ORIGIN, { issue: ["implement", "fix"], pr: ["review"] })).toBeUndefined();
    expect(ingestConfig(list, ORIGIN, { issue: ["implement"], pr: ["review"] })).toEqual({ issue: ["implement"] });
    expect(ingestConfig(list, ORIGIN, { issue: ["fix", "implement"], pr: ["review", "audit"] })).toEqual({ pr: ["audit", "review"] });
  });
});
