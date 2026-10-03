import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createPrDraft, DraftError, type DraftDeps } from "../drafts/actions.js";
import type { BridgeSession } from "./sessions.js";

interface ToolDef {
  tool: Tool;
  /** The playbook must allow this draft type; tools without one are always there. */
  draft?: string;
  call: (deps: DraftDeps, session: BridgeSession, args: unknown) => CallToolResult;
}

const text = (t: string, isError = false): CallToolResult => (isError ? { content: [{ type: "text", text: t }], isError } : { content: [{ type: "text", text: t }] });

const DraftPrArgs = z.object({ title: z.string().trim().min(1), body: z.string() });

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
      try {
        createPrDraft(deps, session.itemId, parsed.data);
      } catch (e) {
        if (e instanceof DraftError) return text(`No draft was created: ${e.message}.`, true);
        throw e;
      }
      return text("Draft created, the user will review it.");
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
export function callTool(deps: DraftDeps, session: BridgeSession, name: string, args: unknown): CallToolResult {
  const def = allowed(session).find((t) => t.tool.name === name);
  if (!def) return text(`Unknown tool "${name}". Available: ${listTools(session).map((t) => t.name).join(", ")}.`, true);
  return def.call(deps, session, args);
}
