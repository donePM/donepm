import { describe, expect, it } from "vitest";
import type { ItemView } from "../api/types";
import { cardBadge } from "./card-badge";

const item = (extra: Partial<ItemView> = {}): ItemView =>
  ({ id: "i1", externalId: "a/b#1", title: "T", state: "ready", labels: [], badges: [], source: "github-issue", agent: { running: false }, ...extra }) as ItemView;

describe("cardBadge", () => {
  it("names a Ready issue by its first label, toned by kind", () => {
    expect(cardBadge(item({ labels: ["bug", "search"] }))).toEqual({ text: "bug", tone: "danger", label: "bug" });
    expect(cardBadge(item({ labels: ["enhancement"] }))?.tone).toBe("primary");
    expect(cardBadge(item({ labels: ["docs"] }))?.tone).toBe("plain");
    expect(cardBadge(item())).toBeUndefined();
  });

  it("names someone else's pull request before its labels", () => {
    expect(cardBadge(item({ source: "github-pr", author: "dependabot[bot]", labels: ["deps"] }))).toMatchObject({ text: "PR · dependabot", tone: "primary" });
  });

  it("shows no badge while running or waiting for CI; the status line says it", () => {
    expect(cardBadge(item({ state: "running", labels: ["bug"] }))).toBeUndefined();
    expect(cardBadge(item({ state: "checking", labels: ["bug"] }))).toBeUndefined();
  });

  it("puts what needs the user first", () => {
    const draft = (extra: object) => item({ state: "needs_you", attention: { kind: "draft", draftId: "d", draftType: "pr", title: "x", ...extra } as ItemView["attention"] });
    expect(cardBadge(draft({}))).toEqual({ text: "PR draft", tone: "attn", icon: "pr" });
    expect(cardBadge(draft({ executing: true }))?.text).toBe("publishing");
    expect(cardBadge(draft({ error: "boom" }))).toMatchObject({ text: "PR failed", tone: "danger" });
    expect(cardBadge(draft({ draftType: "update_branch" }))?.text).toBe("update draft");
    expect(cardBadge(draft({ draftType: "update_branch", executing: true }))?.text).toBe("updating");
    expect(cardBadge(draft({ draftType: "ticket_comment" }))?.text).toBe("comment draft");
    expect(cardBadge(draft({ draftType: "ticket_comment", executing: true }))?.text).toBe("posting");
    expect(cardBadge(draft({ draftType: "ticket_transition" }))?.text).toBe("move draft");
    expect(cardBadge(draft({ draftType: "ticket_transition", executing: true }))?.text).toBe("moving");
    expect(cardBadge(draft({ draftType: "ticket_transition", error: "boom" }))?.text).toBe("move failed");
    const kind = (kind: string) => cardBadge(item({ state: "needs_you", attention: { kind } as ItemView["attention"] }))?.text;
    expect(kind("ask")).toBe("permission");
    expect(kind("pr_conflict")).toBe("conflict");
    expect(kind("ci_failed")).toBe("CI failed");
    expect(kind("failed")).toBe("failed");
  });

  it("says how a finished item ended", () => {
    expect(cardBadge(item({ state: "done", pr: { merged: true } as ItemView["pr"] }))).toMatchObject({ text: "merged", tone: "ok", icon: "merge" });
    expect(cardBadge(item({ state: "done", badges: ["closed-upstream"] }))).toMatchObject({ text: "closed upstream", tone: "muted" });
    expect(cardBadge(item({ state: "done" }))?.text).toBe("done");
  });
});
