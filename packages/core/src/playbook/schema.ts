import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const PlaybookFrontmatterSchema = z
  .object({
    name: nonEmpty.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "name may contain letters, digits, '-' and '_'"),
    model: nonEmpty,
    effort: nonEmpty.optional(),
    permission_mode: z.enum(["acceptEdits", "plan", "bypassPermissions"]),
    drafts: z.array(z.enum(["pr"])),
    match: z
      .object({
        source: nonEmpty.optional(),
        labels: z.array(nonEmpty).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PlaybookFrontmatter = z.infer<typeof PlaybookFrontmatterSchema>;

export interface Playbook {
  name: string;
  model: string;
  effort?: string;
  permissionMode: PlaybookFrontmatter["permission_mode"];
  drafts: PlaybookFrontmatter["drafts"];
  match?: { source?: string; labels?: string[] };
  /** Template for the first user message. */
  body: string;
}
