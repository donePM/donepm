import type { SourceIssue } from "@donepm/core";
import { z } from "zod";

const Label = z.object({ name: z.string() }).passthrough();

const IssueFields = {
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

/** One entry of `gh search issues --json number,title,body,createdAt,labels,repository,url`. */
export const SearchIssueSchema = z.object({
  ...IssueFields,
  repository: z.object({ nameWithOwner: z.string().regex(/^[^/\s]+\/[^/\s]+$/) }).passthrough(),
});
export const SearchIssuesSchema = z.array(SearchIssueSchema);

/** One entry of `gh issue list --json number,title,body,createdAt,labels,url` (no repository field). */
export const ListIssueSchema = z.object(IssueFields);
export const ListIssuesSchema = z.array(ListIssueSchema);

export const IssueStateSchema = z.object({ state: z.enum(["OPEN", "CLOSED"]) });

export function toSourceIssue(i: z.infer<typeof ListIssueSchema>, repository: string): SourceIssue {
  return {
    repository,
    number: i.number,
    url: i.url,
    title: i.title,
    body: i.body,
    labels: i.labels.map((l) => l.name),
    createdAt: i.createdAt,
  };
}
