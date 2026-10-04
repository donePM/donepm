import type { Settings } from "../../api/types";

export type RetentionFields = Pick<Settings, "archiveAfterHours" | "deleteAfterDays">;

/** What the "Finished items" inputs hold: text, so that an empty delete field can mean "never". */
export interface RetentionInput {
  archiveAfterHours: string;
  deleteAfterDays: string;
}

export function retentionInput(s: RetentionFields): RetentionInput {
  return { archiveAfterHours: String(s.archiveAfterHours), deleteAfterDays: s.deleteAfterDays === null ? "" : String(s.deleteAfterDays) };
}

const wholeNumber = (text: string) => (/^\d+$/.test(text) ? Number(text) : undefined);

/** Whole numbers of 0 or more; an empty delete field is `null` (never delete). */
export function parseRetention(input: RetentionInput): { ok: true; value: RetentionFields } | { ok: false; error: string } {
  const hours = wholeNumber(input.archiveAfterHours.trim());
  if (hours === undefined) return { ok: false, error: "Archive after: a whole number of hours, 0 or more." };
  const days = input.deleteAfterDays.trim();
  if (days === "") return { ok: true, value: { archiveAfterHours: hours, deleteAfterDays: null } };
  const n = wholeNumber(days);
  if (n === undefined) return { ok: false, error: "Delete after: a whole number of days, 0 or more, or empty for never." };
  return { ok: true, value: { archiveAfterHours: hours, deleteAfterDays: n } };
}
