import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createCommentDraft, createPrDraft, createPushDraft, DraftError, type DraftDeps } from "../drafts/actions.js";
import { createReviewDraft } from "../drafts/review.js";
import { createTicketCommentDraft, createTicketTransitionDraft, ticketOf, transitionList } from "../drafts/ticket.js";
import { createUpdateBranchDraft } from "../drafts/update-branch.js";
import type { Exec } from "../process/exec.js";
import type { Providers } from "../providers/registry.js";
import type { BridgeSession } from "./sessions.js";

export type ToolDeps = DraftDeps & { exec: Exec; providers: Providers };

interface ToolDef {
  tool: Tool;
  /** The playbook must allow this draft type; tools without one are always there. */
  draft?: string;
  call: (deps: ToolDeps, session: BridgeSession, args: unknown) => CallToolResult | Promise<CallToolResult>;
}

const text = (t: string, isError = false): CallToolResult => (isError ? { content: [{ type: "text", text: t }], isError } : { content: [{ type: "text", text: t }] });

const DraftPrArgs = z.object({ title: z.string().trim().min(1), body: z.string() });
const Reply = z.object({ body: z.string().trim().min(1), inReplyTo: z.number().int().positive().optional() }).strict();
const DraftPushArgs = z.object({ summary: z.string().trim().min(1), replies: z.array(Reply).optional() });
const DraftCommentArgs = z.object({ replies: z.array(Reply).min(1) });
const ReviewComment = z.object({ path: z.string().trim().min(1), line: z.number().int().positive(), body: z.string().trim().min(1) }).strict();
const DraftReviewArgs = z.object({
  verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  body: z.string(),
  comments: z.array(ReviewComment).optional(),
});
const DraftUpdateBranchArgs = z.object({ reason: z.string().trim().min(1) });
const DraftTicketCommentArgs = z.object({ body: z.string().trim().min(1) });
const DraftTicketTransitionArgs = z.object({ to: z.string().trim().min(1), comment: z.string().optional() });

const REPLIES_SCHEMA = {
  type: "array",
  description:
    "Answers to review feedback, posted after the user approves. Give inReplyTo the thread number from the feedback " +
    "to answer an inline comment; leave it out to comment on the pull request.",
  items: {
    type: "object",
    properties: {
      body: { type: "string", description: "The reply in Markdown" },
      inReplyTo: { type: "integer", description: "Thread number of the inline comment this answers" },
    },
    required: ["body"],
  },
};

/** A draft tool's answer: the draft's creation, or why there is none, as text the model reads. */
async function drafted(create: () => unknown): Promise<CallToolResult> {
  try {
    await create();
  } catch (e) {
    if (e instanceof DraftError) return text(`No draft was created: ${e.message}.`, true);
    throw e;
  }
  return text("Draft created, the user will review it.");
}

const TOOLS: ToolDef[] = [
  {
    tool: {
      name: "whoami",
      description: "What this session works on: the item id, its title, branch, worktree path, repository and, for a pull request under review, its base branch.",
      inputSchema: { type: "object", properties: {} },
    },
    call: (deps, session) => {
      const item = deps.items.get(session.itemId)?.item;
      if (!item) return text("The item for this session no longer exists.", true);
      const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
      return text(
        JSON.stringify(
          {
            itemId: item.id,
            title: item.title,
            ticket: item.externalUrl,
            branch: item.branch ?? null,
            worktreePath: item.worktreePath ?? null,
            ...(item.baseBranch ? { baseBranch: item.baseBranch } : {}),
            repo: repo ? { origin: repo.originUrl, defaultBranch: repo.defaultBranch } : null,
            drafts: session.drafts,
          },
          null,
          2,
        ),
      );
    },
  },
  {
    draft: "pr",
    tool: {
      name: "draft_pr",
      description:
        "Propose a pull request for the work on this branch. The user reviews the draft and creates the PR; " +
        "you cannot push or open PRs yourself. Commit your work before calling this. Call it once, at the end.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Pull request title" },
          body: { type: "string", description: "Pull request description in Markdown" },
        },
        required: ["title", "body"],
      },
    },
    call: (deps, session, args) => {
      const parsed = DraftPrArgs.safeParse(args ?? {});
      if (!parsed.success) return text("draft_pr needs a non-empty `title` and a `body`.", true);
      return drafted(() => createPrDraft(deps, session.itemId, parsed.data));
    },
  },
  {
    // Pushing more commits to the PR the user already approved is part of the same outward action.
    draft: "pr",
    tool: {
      name: "draft_push",
      description:
        "Propose pushing your new commits to this item's open pull request, e.g. after fixing a failed CI or addressing review feedback. " +
        "The user reviews and pushes; you cannot push yourself. Commit your work before calling this.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "What the new commits change, in a sentence or two" },
          replies: REPLIES_SCHEMA,
        },
        required: ["summary"],
      },
    },
    call: (deps, session, args) => {
      const parsed = DraftPushArgs.safeParse(args ?? {});
      if (!parsed.success) return text("draft_push needs a non-empty `summary`; each reply needs a non-empty `body`.", true);
      return drafted(() => createPushDraft(deps, session.itemId, toInput(parsed.data)));
    },
  },
  {
    // Answering reviewers on the PR the user already approved belongs to the same outward action (D39).
    draft: "pr",
    tool: {
      name: "draft_comment",
      description:
        "Propose replies to review feedback on this item's open pull request when no code needs to change. " +
        "The user reviews and posts them; you cannot comment yourself. If you changed code, use draft_push with replies instead.",
      inputSchema: { type: "object", properties: { replies: REPLIES_SCHEMA }, required: ["replies"] },
    },
    call: (deps, session, args) => {
      const parsed = DraftCommentArgs.safeParse(args ?? {});
      if (!parsed.success) return text("draft_comment needs `replies`, each with a non-empty `body`.", true);
      return drafted(() => createCommentDraft(deps, session.itemId, { replies: parsed.data.replies.map(toReply) }));
    },
  },
  {
    draft: "review",
    tool: {
      name: "draft_review",
      description:
        "Propose your review of this pull request. The user reads the draft and posts it; you cannot post it yourself. " +
        "Call it once, at the end. Inline comments go on lines of the new version that are inside the diff's hunks.",
      inputSchema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"], description: "The review's verdict" },
          body: { type: "string", description: "The review summary in Markdown; required unless the verdict is APPROVE" },
          comments: {
            type: "array",
            description: "Inline comments on the changed lines",
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path relative to the repository root" },
                line: { type: "integer", description: "Line number in the new version of the file" },
                body: { type: "string", description: "The comment in Markdown" },
              },
              required: ["path", "line", "body"],
            },
          },
        },
        required: ["verdict", "body"],
      },
    },
    call: (deps, session, args) => {
      const parsed = DraftReviewArgs.safeParse(args ?? {});
      if (!parsed.success) {
        return text("draft_review needs a `verdict` (APPROVE, REQUEST_CHANGES or COMMENT), a `body`, and comments with `path`, a positive `line` and a non-empty `body`.", true);
      }
      return drafted(() => createReviewDraft(deps, session.itemId, { ...parsed.data, comments: parsed.data.comments ?? [] }));
    },
  },
  {
    draft: "review",
    tool: {
      name: "draft_update_branch",
      description:
        "Propose bringing this pull request up to date with its base when it is behind. The user approves it and the " +
        "daemon updates the branch (Dependabot pull requests get an `@dependabot rebase` comment); you cannot do it " +
        "yourself. Afterwards you get a message; go on with your review and call draft_review once, at the end.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why the branch should be updated, shown to the user" },
        },
        required: ["reason"],
      },
    },
    call: (deps, session, args) => {
      const parsed = DraftUpdateBranchArgs.safeParse(args ?? {});
      if (!parsed.success) return text("draft_update_branch needs a non-empty `reason`.", true);
      return drafted(() => createUpdateBranchDraft(deps, session.itemId, parsed.data));
    },
  },
  {
    draft: "ticket",
    tool: {
      name: "ticket_transitions",
      description:
        "List the transitions the Jira ticket of this item offers now: id, name and the status each leads to. " +
        "Use it before draft_ticket_transition. Reads only.",
      inputSchema: { type: "object", properties: {} },
    },
    call: async (deps, session) => {
      const item = deps.items.get(session.itemId)?.item;
      if (!item) return text("The item for this session no longer exists.", true);
      try {
        const { ref, key, source } = ticketOf(deps.providers, item);
        const r = await source.transitions!(ref);
        if (!r.ok) return text(`Cannot read the transitions of ${key}: ${r.error}.`, true);
        return text(`${key} offers: ${transitionList(r.transitions)}.`);
      } catch (e) {
        if (e instanceof DraftError) return text(`${e.message}.`, true);
        throw e;
      }
    },
  },
  {
    draft: "ticket",
    tool: {
      name: "draft_ticket_comment",
      description:
        "Propose a comment on this item's Jira ticket, e.g. a question for the reporter or a note on what you found. " +
        "The user reviews it and donePM posts it; you cannot post yourself. Afterwards you get a message; go on with your work.",
      inputSchema: {
        type: "object",
        properties: { body: { type: "string", description: "The comment in Markdown" } },
        required: ["body"],
      },
    },
    call: (deps, session, args) => {
      const parsed = DraftTicketCommentArgs.safeParse(args ?? {});
      if (!parsed.success) return text("draft_ticket_comment needs a non-empty `body`.", true);
      return drafted(() => createTicketCommentDraft(deps, session.itemId, parsed.data));
    },
  },
  {
    draft: "ticket",
    tool: {
      name: "draft_ticket_transition",
      description:
        "Propose moving this item's Jira ticket to another status, e.g. to In Review before you call draft_pr. " +
        "Name a transition ticket_transitions lists, by its id, its name or the status it leads to. The user reviews it and " +
        "donePM moves the ticket; you cannot do it yourself. Afterwards you get a message; go on with your work.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "The transition's id or name, or the status it leads to" },
          comment: { type: "string", description: "A comment posted with the move, in Markdown" },
        },
        required: ["to"],
      },
    },
    call: (deps, session, args) => {
      const parsed = DraftTicketTransitionArgs.safeParse(args ?? {});
      if (!parsed.success) return text("draft_ticket_transition needs a non-empty `to`.", true);
      const { to, comment } = parsed.data;
      return drafted(() => createTicketTransitionDraft(deps, session.itemId, { to, ...(comment?.trim() ? { comment } : {}) }));
    },
  },
];

type ReplyArgs = z.infer<typeof Reply>;
const toReply = (r: ReplyArgs) => (r.inReplyTo === undefined ? { body: r.body } : { body: r.body, inReplyTo: r.inReplyTo });
const toInput = (a: z.infer<typeof DraftPushArgs>) => ({ summary: a.summary, ...(a.replies ? { replies: a.replies.map(toReply) } : {}) });

const allowed = (session: BridgeSession) => TOOLS.filter((t) => !t.draft || session.drafts.includes(t.draft as never));

/** The names of donePM's MCP tools an agent with these drafts sees (issue #154). */
export function toolNames(drafts: readonly string[]): string[] {
  return TOOLS.filter((t) => !t.draft || drafts.includes(t.draft)).map((t) => t.tool.name);
}

/** The tools this session may see (spec 10: only drafts the playbook allows). */
export function listTools(session: BridgeSession): Tool[] {
  return allowed(session).map((t) => t.tool);
}

/**
 * Run a tool. A tool the playbook does not allow answers exactly like an unknown one, as an
 * error result the model reads, never a JSON-RPC error (Bloom BRIDGE.md §3).
 */
export async function callTool(deps: ToolDeps, session: BridgeSession, name: string, args: unknown): Promise<CallToolResult> {
  const def = allowed(session).find((t) => t.tool.name === name);
  if (!def) return text(`Unknown tool "${name}". Available: ${listTools(session).map((t) => t.name).join(", ")}.`, true);
  return def.call(deps, session, args);
}
