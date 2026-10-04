import {
  azureOrganizationOf, boardsWorkItemOf, draftCreated, draftEdited, draftRejected, draftTitle, executedPr, prTitleFor, replyThreads, withBoardsLink,
  type CommentDraft, type Ctx, type Draft, type DraftCommit, type DraftReply, type DraftType, type PrDraft, type PrDraftPayload,
  type PushDraft, type WorkItem,
} from "@donepm/core";
import type { ResumeHow } from "../agent/start.js";
import type { EventStore } from "../events/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";
import { setupCopies } from "../worktrees/setup.js";
import type { DraftStore } from "./store.js";

export class DraftError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DraftError";
  }
}

export interface DraftDeps {
  items: ItemStore;
  repos: RepoStore;
  drafts: DraftStore;
  events: EventStore;
  writer: ItemWriter;
  ctx: Ctx;
}

/** `draft_pr` (spec 10): a pending PR draft against the repo's default branch; the item waits for the user. */
export function createPrDraft(deps: DraftDeps, itemId: string, input: { title: string; body: string }): Draft {
  const item = draftableItem(deps, itemId);
  if (executedPr(deps.drafts.forItem(itemId))) {
    throw new DraftError(409, "the pull request is already open; call draft_push to add commits to it");
  }
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo) throw new DraftError(409, "the item has no local clone");

  // A ticket's PR title starts with its key, which links the two in Jira (issue #139).
  const title = prTitleFor(item.externalId, input.title);
  // A GitHub PR names its Azure Boards work item as AB#1234, which the Azure Boards app links;
  // an Azure Repos one links it when it is created (issue #142).
  const workItem = boardsWorkItemOf(item);
  const body = workItem && azureOrganizationOf(repo.originUrl) === undefined ? withBoardsLink(input.body, workItem.id) : input.body;
  const draft: PrDraft = {
    id: deps.ctx.newId(),
    itemId,
    type: "pr",
    payload: { title, body, base: repo.defaultBranch },
    state: "pending",
  };
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(item, deps.ctx, draft.id, { type: "pr", title }));
  return draft;
}

/**
 * `draft_push` (decision D35): the agent's new commits on the item's branch, for the PR its PR
 * draft opened. The daemon lists the commits the remote branch lacks; uncommitted changes are
 * committed when the push runs, as with a PR draft. Nothing new is an error the agent reads.
 */
export async function createPushDraft(
  deps: DraftDeps & { exec: Exec },
  itemId: string,
  input: { summary: string; replies?: DraftReply[] },
): Promise<Draft> {
  const item = draftableItem(deps, itemId);
  const pr = executedPr(deps.drafts.forItem(itemId));
  if (!pr) throw new DraftError(409, "there is no pull request yet; call draft_pr instead");
  const replies = checkedReplies(deps, itemId, input.replies ?? []);
  if (!item.worktreePath || !item.branch) throw new DraftError(409, "the item has no worktree");
  const { commits, uncommitted } = await unpushed(deps.exec, item.worktreePath, item.branch);
  if (commits.length === 0 && !uncommitted) throw new DraftError(409, "nothing to push: commit your changes first");

  const draft: PushDraft = {
    id: deps.ctx.newId(),
    itemId,
    type: "push",
    payload: {
      summary: input.summary, number: pr.number, url: pr.url, branch: item.branch, commits, uncommitted,
      ...(replies.length ? { replies } : {}),
    },
    state: "pending",
  };
  // Re-read: git ran meanwhile and the agent may have ended its turn.
  const current = draftableItem(deps, itemId);
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(current, deps.ctx, draft.id, { type: "push", title: draftTitle(draft) }));
  return draft;
}

/**
 * `draft_comment` (decision D39): answers to review feedback when no code changes. The user
 * approves, the daemon posts them as the user.
 */
export function createCommentDraft(deps: DraftDeps, itemId: string, input: { replies: DraftReply[] }): Draft {
  const item = draftableItem(deps, itemId);
  const pr = executedPr(deps.drafts.forItem(itemId));
  if (!pr) throw new DraftError(409, "there is no pull request to comment on");
  const replies = checkedReplies(deps, itemId, input.replies);
  if (replies.length === 0) throw new DraftError(409, "there is nothing to post: give at least one reply");
  const draft: CommentDraft = { id: deps.ctx.newId(), itemId, type: "comment", payload: { number: pr.number, url: pr.url, replies }, state: "pending" };
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(item, deps.ctx, draft.id, { type: "comment", title: draftTitle(draft) }));
  return draft;
}

/** Replies may only answer inline threads a `pr.feedback` brought in, so they land where meant. */
function checkedReplies(deps: DraftDeps, itemId: string, replies: DraftReply[]): DraftReply[] {
  const threads = replyThreads(deps.events.forItem(itemId));
  for (const r of replies) {
    if (r.inReplyTo !== undefined && !threads.has(r.inReplyTo)) {
      throw new DraftError(409, `there is no review thread ${r.inReplyTo}; use a thread number from the feedback, or leave inReplyTo out`);
    }
  }
  return replies.map((r) => (r.inReplyTo === undefined ? { body: r.body } : { body: r.body, inReplyTo: r.inReplyTo }));
}

/** Commits on HEAD the remote branch lacks, oldest first, and whether changes are uncommitted. */
async function unpushed(exec: Exec, worktree: string, branch: string): Promise<{ commits: DraftCommit[]; uncommitted: boolean }> {
  const git = (...args: string[]) => exec("git", ["-C", worktree, ...args]);
  const log = await git("log", "--reverse", "--format=%H%x09%s", `refs/remotes/origin/${branch}..HEAD`);
  if (log.code !== 0) throw new DraftError(409, `cannot list the new commits: ${log.stderr.trim() || `git log exited with ${log.code}`}`);
  const commits = log.stdout.split("\n").flatMap((line) => {
    const [sha, ...subject] = line.split("\t");
    return sha ? [{ sha, subject: subject.join("\t") }] : [];
  });
  const status = await git("status", "--porcelain", "--untracked-files=all");
  const copies = new Set(await setupCopies(worktree));
  const uncommitted = status.stdout.split("\n").some((l) => l.trim() && !copies.has(l.slice(3)));
  return { commits, uncommitted };
}

export function draftableItem(deps: DraftDeps, itemId: string): WorkItem {
  const item = itemOf(deps, itemId);
  if (item.state !== "running") throw new DraftError(409, `the item is ${item.state}, a draft can only be made while the agent is working`);
  if (deps.drafts.pending(itemId).length > 0) {
    throw new DraftError(409, "a draft is already waiting for the user's review; wait for their answer");
  }
  return item;
}

/** The user changed a pending PR draft. Edits are kept beside the agent's payload. */
export function editDraft(deps: DraftDeps, draftId: string, edits: Partial<PrDraftPayload>): Draft {
  const draft = pendingDraft(deps, draftId);
  if (draft.type !== "pr") throw new DraftError(409, "only a pull request draft can be edited");
  const item = itemOf(deps, draft.itemId);
  const userEdits = { ...(draft.userEdits ?? draft.payload), ...edits };
  // Transition first: it throws while the item is not waiting on the user.
  const t = draftEdited(item, deps.ctx, draft.id);
  deps.drafts.setUserEdits(draft.id, userEdits, deps.ctx.now());
  deps.writer.commit(t);
  return { ...draft, userEdits };
}

export interface RejectDeps extends DraftDeps {
  agentAlive: (itemId: string) => boolean;
  say: (itemId: string, text: string) => void;
  /** Starts the agent again with `--resume`, committing `transition` and sending `prompt` first. */
  resume: (itemId: string, how: ResumeHow) => Promise<unknown>;
}

/**
 * The user rejected a pending draft. The item runs again and the reason reaches the agent as its
 * next message: through `say` while the process lives, else as the first message of a resumed
 * session (e.g. after a daemon restart). Resume errors (no session, no worktree) pass through.
 */
export async function rejectDraft(deps: RejectDeps, draftId: string, reason: string | undefined): Promise<Draft> {
  const draft = pendingDraft(deps, draftId);
  const item = itemOf(deps, draft.itemId);
  const message = rejectionMessage(reason, draft.type);
  const transition = (current: WorkItem, ctx: Ctx) => {
    const t = draftRejected(current, ctx, draft.id, reason);
    deps.drafts.setState(draft.id, "rejected", ctx.now());
    return t;
  };
  if (deps.agentAlive(item.id)) {
    deps.writer.commit(transition(item, deps.ctx));
    deps.say(item.id, message);
  } else {
    await deps.resume(item.id, { transition, prompt: message });
  }
  return { ...draft, state: "rejected" };
}

const REJECTED: Record<DraftType, { what: string; tool: string; tail?: string }> = {
  pr: { what: "pull request draft", tool: "draft_pr" },
  push: { what: "push draft", tool: "draft_push" },
  comment: { what: "replies", tool: "draft_comment" },
  review: { what: "review", tool: "draft_review" },
  update_branch: {
    what: "update-branch draft",
    tool: "draft_update_branch",
    tail: "Leave the branch as it is. Go on with your review and call draft_review once, at the end.",
  },
  ticket_comment: {
    what: "ticket comment",
    tool: "draft_ticket_comment",
    tail: "Nothing was posted. Go on with your work; call draft_ticket_comment again only if their reason asks for a changed comment.",
  },
  ticket_transition: {
    what: "ticket transition",
    tool: "draft_ticket_transition",
    tail: "The ticket stays where it is. Go on with your work; call draft_ticket_transition again only if their reason asks for another move.",
  },
};

export function rejectionMessage(reason: string | undefined, type: DraftType = "pr"): string {
  const head = `The user rejected your ${REJECTED[type].what}.`;
  const tail = REJECTED[type].tail ?? `Revise the work and call ${REJECTED[type].tool} again when it is ready.`;
  return reason ? `${head}\n\nTheir reason:\n${reason}\n\n${tail}` : `${head}\n\n${tail}`;
}

function pendingDraft(deps: DraftDeps, id: string): Draft {
  const draft = deps.drafts.get(id);
  if (!draft) throw new DraftError(404, "draft not found");
  if (draft.state !== "pending") throw new DraftError(409, `draft is already ${draft.state}`);
  return draft;
}

function itemOf(deps: DraftDeps, id: string): WorkItem {
  const stored = deps.items.get(id);
  if (!stored) throw new DraftError(404, "item not found");
  return stored.item;
}
