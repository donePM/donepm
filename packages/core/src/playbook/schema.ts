import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const PlaybookFrontmatterSchema = z
  .object({
    name: nonEmpty.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "name may contain letters, digits, '-' and '_'"),
    model: nonEmpty,
    effort: nonEmpty.optional(),
    permission_mode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]),
    /**
     * The agent only reads (D42): no file edits, no web access, Bash only for `git diff`, `git log`
     * and `git show` without a question. For reviewing code the user did not write.
     */
    read_only: z.boolean().optional(),
    drafts: z.array(z.enum(["pr", "review"])),
    match: z
      .object({
        source: nonEmpty.optional(),
        labels: z.array(nonEmpty).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((fm, ctx) => {
    if (!fm.read_only) return;
    if (fm.drafts.includes("pr")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["drafts"], message: "a read_only playbook cannot draft pull requests" });
    }
    if (fm.permission_mode !== "default") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["permission_mode"], message: "a read_only playbook needs permission_mode: default" });
    }
  });

export type PlaybookFrontmatter = z.infer<typeof PlaybookFrontmatterSchema>;

export interface Playbook {
  name: string;
  model: string;
  effort?: string;
  permissionMode: PlaybookFrontmatter["permission_mode"];
  drafts: PlaybookFrontmatter["drafts"];
  /** `read_only` in the frontmatter (D42). */
  readOnly?: boolean;
  match?: { source?: string; labels?: string[] };
  /** Template for the first user message. */
  body: string;
}
