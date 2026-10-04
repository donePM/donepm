import type { ItemView } from "../api/types";
import { labelTone } from "./columns";
import { prKind } from "./pr-kind";

export type BadgeTone = "primary" | "attn" | "ok" | "danger" | "muted" | "plain";
export type BadgeIcon = "pr" | "merge" | "shield" | "alert" | "check";

/** The one badge at the top right of a card (spec 12.1). */
export interface CardBadge {
  text: string;
  tone: BadgeTone;
  icon?: BadgeIcon;
  title?: string;
  /** The label shown as the badge; the card's tags leave it out. */
  label?: string;
}

/**
 * What the card's corner says. Running and waiting-for-CI cards show a live status line there
 * instead, so they get none. Attention comes first, then how a finished item ended, then what the
 * item is: someone else's pull request, else its first label.
 */
export function cardBadge(item: ItemView): CardBadge | undefined {
  const a = item.attention;
  if (a) {
    switch (a.kind) {
      case "draft": {
        const what = a.draftType === "push" ? "push" : a.draftType === "comment" ? "replies" : a.draftType === "review" ? "review" : "PR";
        if (a.error) return { text: `${what} failed`, tone: "danger", icon: "alert", title: a.error };
        if (a.executing) return { text: a.draftType === "pr" ? "publishing" : a.draftType === "push" ? "pushing" : "posting", tone: "attn", icon: "pr" };
        return { text: `${what} draft`, tone: "attn", icon: "pr" };
      }
      case "ask":
        return { text: "permission", tone: "attn", icon: "shield" };
      case "ci_failed":
        return { text: "CI failed", tone: "danger", icon: "alert" };
      case "pr_conflict":
        return { text: "conflict", tone: "attn", icon: "merge" };
      case "pr_feedback":
        return { text: "review", tone: "attn", icon: "pr" };
      case "resume":
        return { text: "interrupted", tone: "attn", icon: "alert" };
      case "failed":
        return { text: "failed", tone: "danger", icon: "alert" };
    }
  }
  if (item.state === "running" || item.state === "checking") return undefined;
  if (item.state === "done") {
    if (item.pr?.merged) return { text: "merged", tone: "ok", icon: "merge" };
    if (item.badges.includes("closed-upstream")) return { text: "closed upstream", tone: "muted" };
    return { text: "done", tone: "ok", icon: "check" };
  }
  if (item.badges.includes("closed-upstream")) return { text: "closed upstream", tone: "muted" };
  const pr = prKind(item);
  if (pr) return { text: pr.text, tone: "primary", icon: "pr", title: pr.title };
  const label = item.labels[0];
  if (!label) return undefined;
  const tone = labelTone(label);
  return { text: label, tone: tone === "bug" ? "danger" : tone === "feature" ? "primary" : "plain", label };
}
