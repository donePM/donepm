import { describe, expect, it } from "vitest";
import type { PlaybookEntry } from "../../api/types";
import { matchText, originText, sourceText } from "./describe";

const pb = (over: Partial<PlaybookEntry> = {}): PlaybookEntry => ({
  name: "implement", model: "opus", permissionMode: "acceptEdits", drafts: ["pr"], body: "", tools: [], permissions: { allow: [], deny: [] },
  file: "/pb/implement.md", scope: { kind: "global" }, ...over,
});
const repo: PlaybookEntry["scope"] = { kind: "repo", repoId: "r1", origin: "github.com/acme/widgets", path: "/r" };

describe("playbook descriptions (#154)", () => {
  it("says where a playbook comes from", () => {
    expect(sourceText(pb({ builtIn: "default" }))).toBe("Built-in, unchanged");
    expect(sourceText(pb({ builtIn: "edited" }))).toBe("Built-in, edited by you");
    expect(sourceText(pb())).toBe("Your own file");
    expect(sourceText(pb({ scope: repo }))).toBe("From the repository's .donepm/playbooks (acme/widgets)");
    expect(originText(pb())).toBe("global");
    expect(originText(pb({ scope: repo, overridesGlobal: true }))).toBe("overridden in acme/widgets");
  });

  it("describes the match filter", () => {
    expect(matchText(undefined)).toBe("every item");
    expect(matchText({ source: "github-pr" })).toBe("pull requests (github-pr)");
    expect(matchText({ source: "github-issue", labels: ["bug", "chore"] })).toBe("issues (github-issue), labelled bug or chore");
  });
});
