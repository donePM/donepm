import {
  draftCreated, draftTitle, parseTicketId, type TicketCommentDraft, type TicketTransitionDraft, type WorkItem,
} from "@donepm/core";
import { ticketConnectionOf, type Providers } from "../providers/registry.js";
import type { TicketRef, TicketSource, TicketTransition } from "../providers/ticket-source.js";
import { DraftError, draftableItem, type DraftDeps } from "./actions.js";

export type TicketDraftDeps = DraftDeps & { providers: Providers };

/** The item's ticket and the source that can write to it; refused for an item that is no ticket. */
export function ticketOf(providers: Providers, item: WorkItem): { ref: TicketRef; key: string; source: TicketSource } {
  const id = parseTicketId(item.externalId);
  if (!id) throw new DraftError(409, "this item is not a Jira ticket or Azure Boards work item; ticket drafts are for ticket items only");
  const ref = { externalId: item.externalId, origin: item.repoOrigin ?? "" };
  const source = ticketConnectionOf(providers, ref)?.ticketSource;
  if (!source?.comment || !source.transitions || !source.transition) throw new DraftError(409, `there is no connection "${id.connection}" that can write to the ticket`);
  return { ref, key: id.key, source };
}

/**
 * `draft_ticket_comment` (issue #139): a comment on the item's own ticket. The user approves it,
 * the daemon posts it as the user, and the agent goes on.
 */
export function createTicketCommentDraft(deps: TicketDraftDeps, itemId: string, input: { body: string }): TicketCommentDraft {
  const item = draftableItem(deps, itemId);
  const { key } = ticketOf(deps.providers, item);
  const body = input.body.trim();
  if (!body) throw new DraftError(409, "the comment is empty");
  const draft: TicketCommentDraft = { id: deps.ctx.newId(), itemId, type: "ticket_comment", payload: { key, url: item.externalUrl, body }, state: "pending" };
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(item, deps.ctx, draft.id, { type: "ticket_comment", title: draftTitle(draft) }));
  return draft;
}

/**
 * `draft_ticket_transition` (issue #139): moving the item's ticket to another status. `to` names a
 * transition the workflow offers now, by its id, its name or the status it leads to; it is checked
 * against Jira here, so the user only ever approves a move Jira offered.
 */
export async function createTicketTransitionDraft(
  deps: TicketDraftDeps,
  itemId: string,
  input: { to: string; comment?: string },
): Promise<TicketTransitionDraft> {
  const item = draftableItem(deps, itemId);
  const { ref, key, source } = ticketOf(deps.providers, item);
  const offered = await source.transitions!(ref);
  if (!offered.ok) throw new DraftError(409, `cannot read the ticket's transitions: ${offered.error}`);
  const chosen = pickTransition(offered.transitions, input.to);
  if (chosen.requiredFields.length) {
    throw new DraftError(409, `the transition "${chosen.name}" needs fields donePM cannot fill (${chosen.requiredFields.join(", ")}); ask the user to move the ticket`);
  }
  const comment = input.comment?.trim();
  const draft: TicketTransitionDraft = {
    id: deps.ctx.newId(),
    itemId,
    type: "ticket_transition",
    payload: { key, url: item.externalUrl, transitionId: chosen.id, toStatus: chosen.toStatus, ...(comment ? { comment } : {}) },
    state: "pending",
  };
  // Re-read: Jira answered meanwhile and the agent may have ended its turn.
  const current = draftableItem(deps, itemId);
  deps.drafts.insert(draft, deps.ctx.now());
  deps.writer.commit(draftCreated(current, deps.ctx, draft.id, { type: "ticket_transition", title: draftTitle(draft) }));
  return draft;
}

/** The transition `to` names: by id first, then by its name or its target status, ignoring case. */
export function pickTransition(transitions: readonly TicketTransition[], to: string): TicketTransition {
  const want = to.trim().toLowerCase();
  const found =
    transitions.find((t) => t.id === to.trim()) ??
    transitions.find((t) => t.name.toLowerCase() === want) ??
    transitions.find((t) => t.toStatus.toLowerCase() === want);
  if (found) return found;
  throw new DraftError(409, `the ticket offers no transition "${to}" now; it offers ${transitionList(transitions)}`);
}

/** `"21" Start progress → In Progress; "31" Review → In Review`, for the agent to choose from. */
export function transitionList(transitions: readonly TicketTransition[]): string {
  if (transitions.length === 0) return "none";
  return transitions
    .map((t) => `"${t.id}" ${t.name} → ${t.toStatus}${t.requiredFields.length ? ` (needs ${t.requiredFields.join(", ")})` : ""}`)
    .join("; ");
}
