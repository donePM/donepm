import { describe, expect, it } from "vitest";
import implementMd from "../../../daemon/playbooks/implement.md?raw";
import reviewMd from "../../../daemon/playbooks/review.md?raw";
import { parsePlaybook } from "./parse.js";
import { PlaceholderError, placeholderValues, renderPlaybookBody } from "./render.js";

const values = placeholderValues({
  externalId: "o/r#7", title: "Fix it", body: "Body text", labels: ["bug", "p1"], branch: "dp/7-fix-it", base: "main", repoPath: "/repo",
});

describe("renderPlaybookBody", () => {
  it("replaces all placeholders, with or without spaces", () => {
    expect(renderPlaybookBody("{{ externalId }}|{{title}}|{{  body  }}|{{ labels }}|{{ branch }}|{{ base }}|{{ repoPath }}", values))
      .toBe("o/r#7|Fix it|Body text|bug, p1|dp/7-fix-it|main|/repo");
  });
  it("replaces repeated placeholders", () => {
    expect(renderPlaybookBody("{{ title }} {{ title }}", values)).toBe("Fix it Fix it");
  });
  it("does not re-expand placeholders inside values", () => {
    const v = { ...values, body: "see {{ title }} and {{ nope }}" };
    expect(renderPlaybookBody("{{ body }}", v)).toBe("see {{ title }} and {{ nope }}");
  });
  it("leaves $-patterns in values alone", () => {
    expect(renderPlaybookBody("{{ body }}", { ...values, body: "cost $& $1" })).toBe("cost $& $1");
  });
  it("throws on unknown placeholders", () => {
    expect(() => renderPlaybookBody("{{ nope }}", values)).toThrow(PlaceholderError);
  });
  it("renders empty labels as empty string", () => {
    expect(placeholderValues({ ...values, labels: [] }).labels).toBe("");
  });
  it("renders the default playbook", () => {
    const out = renderPlaybookBody(parsePlaybook(implementMd).body, values);
    expect(out).toContain("## Issue o/r#7: Fix it");
    expect(out).toContain("`dp/7-fix-it`");
    expect(out).not.toContain("{{");
  });
  it("renders the review playbook with the pull request's base", () => {
    const out = renderPlaybookBody(parsePlaybook(reviewMd).body, { ...values, base: "minor" });
    expect(out).toContain("## Pull request o/r#7: Fix it");
    expect(out).toContain("git diff origin/minor...HEAD");
    expect(out).not.toContain("{{");
  });
});
