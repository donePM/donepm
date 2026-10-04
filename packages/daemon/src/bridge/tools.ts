import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createPrDraft, createPushDraft, DraftError, type DraftDeps } from "../drafts/actions.js";
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
const DraftPushArgs = z.object({ summary: z.string().trim().min(1) });

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
        "Propose pushing your new commits to this item's open pull request, e.g. after fixing a failed CI. " +
        "The user reviews and pushes; you cannot push yourself. Commit your work before calling this.",
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string", description: "What the new commits change, in a sentence or two" } },
        required: ["summary"],
      },
    },
    call: (deps, session, args) => {
      const parsed = DraftPushArgs.safeParse(args ?? {});
      if (!parsed.success) return text("draft_push needs a non-empty `summary`.", true);
      return drafted(() => createPushDraft(deps, session.itemId, parsed.data));
    },
  },
];

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
