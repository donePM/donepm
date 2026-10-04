import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createCommentDraft, createPrDraft, createPushDraft, DraftError, type DraftDeps } from "../drafts/actions.js";
import type { Exec } from "../process/exec.js";
import type { BridgeSession } from "./sessions.js";

export type ToolDeps = DraftDeps & { exec: Exec };

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
      description: "What this session works on: the item id, its title, branch, worktree path and repository.",
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
];

type ReplyArgs = z.infer<typeof Reply>;
const toReply = (r: ReplyArgs) => (r.inReplyTo === undefined ? { body: r.body } : { body: r.body, inReplyTo: r.inReplyTo });
const toInput = (a: z.infer<typeof DraftPushArgs>) => ({ summary: a.summary, ...(a.replies ? { replies: a.replies.map(toReply) } : {}) });

const allowed = (session: BridgeSession) => TOOLS.filter((t) => !t.draft || session.drafts.includes(t.draft as never));

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
