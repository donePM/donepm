import { describe, expect, it } from "vitest";
import type { PlaybookEntry } from "../api/types";
import { playbookOptions } from "./playbook-options";

const entry = (name: string, model: string, scope: PlaybookEntry["scope"]): PlaybookEntry => ({
  name,
  model,
  permissionMode: "default",
  drafts: [],
  body: "",
  tools: [],
  permissions: { allow: [], deny: [] },
  file: `${name}.md`,
  scope,
});
const repo = (repoId: string): PlaybookEntry["scope"] => ({ kind: "repo", repoId, origin: "github.com/a/b", path: "/r" });

describe("playbookOptions", () => {
  it("offers global playbooks and the repo's own, the repo's replacing the global of the same name", () => {
    const entries = [
      entry("implement", "opus", { kind: "global" }),
      entry("triage", "haiku", { kind: "global" }),
      entry("implement", "sonnet", repo("r1")),
      entry("docs", "haiku", repo("r2")),
    ];
    expect(playbookOptions(entries, "r1", "implement")).toEqual([
      { name: "implement", label: "implement · sonnet" },
      { name: "triage", label: "triage · haiku" },
    ]);
  });

  it("keeps the current playbook when no file defines it", () => {
    expect(playbookOptions([], undefined, "implement")).toEqual([{ name: "implement", label: "implement" }]);
  });
});
