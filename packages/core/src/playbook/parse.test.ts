import { describe, expect, it } from "vitest";
import implementMd from "../../../daemon/playbooks/implement.md?raw";
import { PlaybookParseError, parsePlaybook } from "./parse.js";

const valid = (extra = "") =>
  `---\nname: implement\nmodel: opus\npermission_mode: acceptEdits\ndrafts: [pr]\n${extra}---\nHello {{ title }}\n`;

describe("parsePlaybook", () => {
  it("parses the shipped default playbook", () => {
    const p = parsePlaybook(implementMd);
    expect(p).toMatchObject({
      name: "implement", model: "opus", effort: "high", permissionMode: "acceptEdits",
      drafts: ["pr"], match: { source: "github-issue" },
    });
    expect(p.body).toContain("{{ branch }}");
    expect(p.body).toContain("draft_pr");
  });

  it("parses a minimal playbook", () => {
    const p = parsePlaybook(valid());
    expect(p.effort).toBeUndefined();
    expect(p.match).toBeUndefined();
    expect(p.body).toBe("Hello {{ title }}\n");
  });

  it("parses match.labels", () => {
    expect(parsePlaybook(valid("match:\n  labels: [bug, urgent]\n")).match).toEqual({ labels: ["bug", "urgent"] });
  });

  it.each([
    ["missing name", "---\nmodel: o\npermission_mode: plan\ndrafts: [pr]\n---\nx", /name/],
    ["missing model", "---\nname: a\npermission_mode: plan\ndrafts: [pr]\n---\nx", /model/],
    ["missing permission_mode", "---\nname: a\nmodel: o\ndrafts: [pr]\n---\nx", /permission_mode/],
    ["missing drafts", "---\nname: a\nmodel: o\npermission_mode: plan\n---\nx", /drafts/],
    ["bad permission_mode", "---\nname: a\nmodel: o\npermission_mode: yolo\ndrafts: [pr]\n---\nx", /permission_mode/],
    ["bad draft type", "---\nname: a\nmodel: o\npermission_mode: plan\ndrafts: [merge]\n---\nx", /drafts/],
    ["drafts not a list", "---\nname: a\nmodel: o\npermission_mode: plan\ndrafts: pr\n---\nx", /drafts/],
    ["unknown key", "---\nname: a\nmodel: o\npermission_mode: plan\ndrafts: [pr]\nfoo: 1\n---\nx", /foo/],
    ["unknown match key", valid("match:\n  color: red\n"), /match/],
    ["bad name", "---\nname: a b\nmodel: o\npermission_mode: plan\ndrafts: [pr]\n---\nx", /name/],
    ["yaml syntax error", "---\nname: [unclosed\nmodel: o\n---\nx", /frontmatter/],
    ["frontmatter not a mapping", "---\n- a\n- b\n---\nx", /root|Expected object/i],
    ["no frontmatter", "just text", /frontmatter/],
    ["unclosed frontmatter", "---\nname: a\n", /closing/],
    ["empty body", "---\nname: a\nmodel: o\npermission_mode: plan\ndrafts: [pr]\n---\n  \n", /body/],
  ])("fails: %s", (_n, src, re) => {
    expect(() => parsePlaybook(src)).toThrow(PlaybookParseError);
    expect(() => parsePlaybook(src)).toThrow(re);
  });
});
