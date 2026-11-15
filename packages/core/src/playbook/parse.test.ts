import { describe, expect, it } from "vitest";
import implementMd from "../../../daemon/playbooks/implement.md?raw";
import reviewMd from "../../../daemon/playbooks/review.md?raw";
import { PlaybookParseError, parsePlaybook } from "./parse.js";

const valid = (extra = "") =>
  `---\nname: implement\nmodel: opus\npermission_mode: acceptEdits\ndrafts: [pr]\n${extra}---\nHello {{ title }}\n`;

describe("parsePlaybook", () => {
  it("parses the shipped default playbook", () => {
    const p = parsePlaybook(implementMd);
    expect(p).toMatchObject({
      name: "implement", model: "opus", effort: "high", permissionMode: "acceptEdits",
      drafts: ["pr", "ticket"], match: { source: "github-issue" },
    });
    expect(p.body).toContain("{{ branch }}");
    expect(p.body).toContain("draft_pr");
    expect(p.body).toContain("draft_ticket_transition");
  });

  it("parses the shipped review playbook: read-only, review drafts only (D42)", () => {
    const p = parsePlaybook(reviewMd);
    expect(p).toMatchObject({
      name: "review", permissionMode: "default", readOnly: true, drafts: ["review"], match: { source: "github-pr" },
    });
    expect(p.body).toContain("draft_review");
  });

  it("leaves readOnly out unless the playbook says so", () => {
    expect(parsePlaybook(valid())).not.toHaveProperty("readOnly");
    expect(parsePlaybook(valid("read_only: false\n"))).not.toHaveProperty("readOnly");
  });

  it("parses a minimal playbook", () => {
    const p = parsePlaybook(valid());
    expect(p.effort).toBeUndefined();
    expect(p.match).toBeUndefined();
    expect(p.body).toBe("Hello {{ title }}\n");
  });

  it("reads the agent a playbook names (#136)", () => {
    expect(parsePlaybook(valid("agent: claude-code\n")).agent).toBe("claude-code");
    expect(parsePlaybook(valid())).not.toHaveProperty("agent");
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
    ["read_only drafting a PR", "---\nname: a\nmodel: o\npermission_mode: default\nread_only: true\ndrafts: [pr]\n---\nx", /read_only playbook cannot draft pull requests/],
    ["read_only accepting edits", "---\nname: a\nmodel: o\npermission_mode: acceptEdits\nread_only: true\ndrafts: [review]\n---\nx", /permission_mode: default/],
    ["unknown agent", valid("agent: robot\n"), /agent/],
    ["empty body", "---\nname: a\nmodel: o\npermission_mode: plan\ndrafts: [pr]\n---\n  \n", /body/],
  ])("fails: %s", (_n, src, re) => {
    expect(() => parsePlaybook(src)).toThrow(PlaybookParseError);
    expect(() => parsePlaybook(src)).toThrow(re);
  });
});
