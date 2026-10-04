import type { MergeMethod } from "@donepm/core";
import type { IngestPlaybooks, SourceSettings } from "../../api/types";

/** What GitHub's issue search shows for the default source (assigned to me, open). */
export const DEFAULT_QUERY = "is:issue state:open assignee:@me";

/** The form's choices for one repository; auto-merge and the merge method only apply to others' pull requests (D47). */
export interface SourceForm {
  query: string;
  assignOnStart: boolean;
  autoMerge?: boolean;
  mergeMethod?: MergeMethod;
  /** Absent: the repository's `managed` flag stays as it is (D46). */
  managed?: boolean;
  /** The playbook its new issues start with; empty: chosen by labels. */
  playbook?: string;
  /** The playbooks each ingest may run (issue #153); absent: the defaults. */
  playbooks?: IngestPlaybooks;
}

/**
 * The sources map with one repository's form choices replaced; its `managed` flag stays unless the
 * form sets it. Defaults (no query, no assign, no auto-merge, squash, no playbook, the default
 * playbooks per ingest) are left out, and an entry that says nothing beyond
 * them is dropped, so the config stays small.
 */
export function withSource(
  sources: Readonly<Record<string, SourceSettings>>,
  origin: string,
  next: SourceForm,
): Record<string, SourceSettings> {
  const { [origin]: old, ...rest } = sources;
  const query = next.query.trim();
  const managed = next.managed ?? old?.managed;
  const playbook = next.playbook?.trim() || undefined;
  const autoMerge = next.autoMerge === true;
  const mergeMethod = next.mergeMethod && next.mergeMethod !== "squash" ? next.mergeMethod : undefined;
  const playbooks = next.playbooks?.issue || next.playbooks?.pr ? next.playbooks : undefined;
  if (!query && !next.assignOnStart && managed === undefined && !autoMerge && !mergeMethod && !playbook && !playbooks) return rest;
  return {
    ...rest,
    [origin]: {
      ...(query ? { query } : {}),
      assignOnStart: next.assignOnStart,
      ...(managed === undefined ? {} : { managed }),
      ...(autoMerge ? { autoMerge } : {}),
      ...(mergeMethod ? { mergeMethod } : {}),
      ...(playbook ? { playbook } : {}),
      ...(playbooks ? { playbooks } : {}),
    },
  };
}

/** The repository's issue list on GitHub, filtered by the query, to refine it there. */
export function issueSearchUrl(origin: string, query: string): string {
  return `https://${origin}/issues?q=${encodeURIComponent(query.trim() || DEFAULT_QUERY)}`;
}
