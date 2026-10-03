import {
  draftCreated, draftEdited, draftRejected,
  type Ctx, type Draft, type PrDraftPayload, type WorkItem,
} from "@donepm/core";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { RepoStore } from "../repos/store.js";
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
  writer: ItemWriter;
  ctx: Ctx;
}

/** `draft_pr` (spec 10): a pending PR draft against the repo's default branch; the item waits for the user. */
export function createPrDraft(deps: DraftDeps, itemId: string, input: { title: string; body: string }): Draft {
  const item = itemOf(deps, itemId);
  if (item.state !== "running") throw new DraftError(409, `the item is ${item.state}, a draft can only be made while the agent is working`);
  if (deps.drafts.pending(itemId).length > 0) {
    throw new DraftError(409, "a draft is already waiting for the user's review; wait for their answer");
  }
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo) throw new DraftError(409, "the item has no local clone");

  const draft: Draft = {
    id: deps.ctx.newId(),
    itemId,
    type: "pr",
    payload: { title: input.title, body: input.body, base: repo.defaultBranch },
    state: "pending",
  };
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(item, deps.ctx, draft.id, { type: "pr", title: input.title }));
  return draft;
}

/** The user changed a pending draft. Edits are kept beside the agent's payload. */
export function editDraft(deps: DraftDeps, draftId: string, edits: Partial<PrDraftPayload>): Draft {
  const draft = pendingDraft(deps, draftId);
  const item = itemOf(deps, draft.itemId);
  const userEdits = { ...(draft.userEdits ?? draft.payload), ...edits };
  // Transition first: it throws while the item is not waiting on the user.
  const t = draftEdited(item, deps.ctx, draft.id);
  deps.drafts.setUserEdits(draft.id, userEdits, deps.ctx.now());
  deps.writer.commit(t);
  return { ...draft, userEdits };
}

/**
 * The user rejected a pending draft. The item runs again and `say` sends the reason to the agent
 * as its next message. Throws DraftError(409) when no agent is there to hear it.
 */
export function rejectDraft(
  deps: DraftDeps & { agentAlive: (itemId: string) => boolean; say: (itemId: string, text: string) => void },
  draftId: string,
  reason: string | undefined,
): Draft {
  const draft = pendingDraft(deps, draftId);
  const item = itemOf(deps, draft.itemId);
  if (!deps.agentAlive(item.id)) throw new DraftError(409, "the agent for this item is not running");
  const t = draftRejected(item, deps.ctx, draft.id, reason);
  deps.drafts.setState(draft.id, "rejected", deps.ctx.now());
  deps.writer.commit(t);
  deps.say(item.id, rejectionMessage(reason));
  return { ...draft, state: "rejected" };
}

export function rejectionMessage(reason: string | undefined): string {
  const head = "The user rejected your pull request draft.";
  const tail = "Revise the work and call draft_pr again when it is ready.";
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
