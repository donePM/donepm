import type { AskSubject } from "@donepm/core";
import type { ItemView } from "../api/types";
import { askCopyText, askView } from "./view";

/** A permission ask waiting for the user, as the board sees it. */
export interface PendingAsk {
  askId: string;
  itemId: string;
  title: string;
  /** One line: the tool and what it wants. */
  summary: string;
}

/** How many ask ids we remember per browser; the oldest fall out first. */
export const NOTIFIED_LIMIT = 200;

const oneLine = (text: string): string => text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";

/** "Bash: pnpm test", "WebFetch: https://…", or just the tool when the input has no short form. */
export function askSummary(toolName: string, input: unknown, subject?: AskSubject): string {
  const view = askView(toolName, input, undefined, subject);
  const detail = view.kind === "json" ? "" : oneLine(askCopyText(view) ?? "");
  const text = detail.length > 120 ? `${detail.slice(0, 119)}…` : detail;
  return text ? `${toolName}: ${text}` : toolName;
}

/** Items whose current attention is a pending ask. Asks the daemon answers itself never get here. */
export function pendingAsks(items: readonly ItemView[]): PendingAsk[] {
  const out: PendingAsk[] = [];
  for (const item of items) {
    const a = item.attention;
    if (a?.kind === "ask") out.push({ askId: a.askId, itemId: item.id, title: item.title, summary: askSummary(a.toolName, a.input, a.subject) });
  }
  return out;
}

/** The tab title: `(2) donePM` while asks wait. */
export function tabTitle(base: string, pending: number): string {
  return pending > 0 ? `(${pending}) ${base}` : base;
}

/** Notifications need the user's switch on and the browser's permission granted. */
export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

/** The asks to announce now: pending, not announced before (this page view or an earlier one). */
export function asksToNotify(
  pending: readonly PendingAsk[],
  notified: ReadonlySet<string>,
  opts: { enabled: boolean; permission: NotifyPermission },
): PendingAsk[] {
  if (!opts.enabled || opts.permission !== "granted") return [];
  return pending.filter((a) => !notified.has(a.askId));
}

/** `known` plus `added` (new ones last), cut to the newest `limit`. */
export function rememberNotified(known: readonly string[], added: readonly string[], limit = NOTIFIED_LIMIT): string[] {
  const merged = [...known.filter((id) => !added.includes(id)), ...added];
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

/** The favicon as an SVG, with a red dot in the corner while asks wait. */
export function faviconSvg(dot: boolean): string {
  return `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><style>.disc{fill:#000;stroke:#fff}.hole{fill:#fff}@media (prefers-color-scheme: dark){.disc{fill:#fff;stroke:#000}.hole{fill:#000}}</style><circle class="disc" cx="80" cy="80" r="78" stroke-width="4"/><circle class="hole" cx="80" cy="80" r="16"/>${dot ? '<circle cx="124" cy="36" r="30" fill="#dc2626" stroke="#fff" stroke-width="6"/>' : ""}</svg>`;
}
