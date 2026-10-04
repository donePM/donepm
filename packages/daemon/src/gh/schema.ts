import type { SourceIssue } from "@donepm/core";
import { z } from "zod";

const Label = z.object({ name: z.string() }).passthrough();

const IssueFields = {
  /** GitHub's global node id; asked for so the issue fields can be read in one batch (D45). */
  id: z.string().optional(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z
    .string()
    .nullable()
    .transform((b) => b ?? ""),
  labels: z.array(Label),
  url: z.string().url(),
  createdAt: z.string().datetime({ offset: true }),
};

/** One entry of `gh search issues --json id,number,title,body,createdAt,labels,repository,url`. */
export const SearchIssueSchema = z.object({
  ...IssueFields,
  repository: z.object({ nameWithOwner: z.string().regex(/^[^/\s]+\/[^/\s]+$/) }).passthrough(),
});
export const SearchIssuesSchema = z.array(SearchIssueSchema);

/**
 * One entry of `gh search prs --json number,title,body,createdAt,labels,repository,url,author`.
 * A deleted account's pull request has no author.
 */
export const SearchPrSchema = SearchIssueSchema.extend({
  author: z.object({ login: z.string().min(1) }).passthrough().nullable().optional(),
});
export const SearchPrsSchema = z.array(SearchPrSchema);

/** One entry of `gh issue list --json id,number,title,body,createdAt,labels,url` (no repository field). */
export const ListIssueSchema = z.object(IssueFields);
export const ListIssuesSchema = z.array(ListIssueSchema);

/** `gh issue view <n> --json state`; for a pull request's number gh answers MERGED, too. */
export const IssueStateSchema = z.object({ state: z.enum(["OPEN", "CLOSED", "MERGED"]) });

/** `gh pr view <n> --json state,mergedAt`. */
export const PrStateSchema = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  mergedAt: z.string().nullable(),
  /** `MERGEABLE`, `CONFLICTING` or `UNKNOWN` (GitHub has not computed it yet). */
  mergeable: z.string().optional(),
  baseRefName: z.string().optional(),
});

/** A polled issue plus its node id, until the issue fields are read (`withPriorityFields`, D45). */
export type FetchedIssue = SourceIssue & { nodeId?: string };

export function toSourceIssue(i: z.infer<typeof ListIssueSchema>, repository: string): FetchedIssue {
  return {
    ...(i.id ? { nodeId: i.id } : {}),
    repository,
    number: i.number,
    url: i.url,
    title: i.title,
    body: i.body,
    labels: i.labels.map((l) => l.name),
    createdAt: i.createdAt,
  };
}

/** gh's stand-in for a timestamp that is not there yet, e.g. the `completedAt` of a pending check. */
const ZERO_TIME = /^0001-01-01T/;
const OptionalTime = z
  .string()
  .optional()
  .transform((t) => (t && !ZERO_TIME.test(t) ? t : undefined));
const OptionalText = z
  .string()
  .optional()
  .transform((t) => t || undefined);

/** One entry of `gh pr checks --json name,state,bucket,link,workflow,startedAt,completedAt`. */
export const PrCheckSchema = z.object({
  name: z.string(),
  state: z.string(),
  bucket: z.string(),
  link: OptionalText,
  workflow: OptionalText,
  startedAt: OptionalTime,
  completedAt: OptionalTime,
});
export const PrChecksSchema = z.array(PrCheckSchema);
