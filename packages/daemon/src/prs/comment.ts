import { prCommented, type WorkItem } from "@donepm/core";
import { postReply } from "../gh/pr-replies.js";
import type { Exec } from "../process/exec.js";
import { PrActionError, type PrActionDeps } from "./actions.js";

/** A comment longer than this is not what the card's form is for. */
const MAX_BODY = 65_536;

/**
 * Posts a comment on someone else's pull request, as the user, from the card (D47): typically the
 * request to resolve a conflict. The user wrote or edited the text and clicked Post; that is the
 * approval. donePM never pushes to the author's branch.
 */
export async function commentOnPr(deps: PrActionDeps & { exec: Exec }, itemId: string, body: string): Promise<WorkItem> {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PrActionError(404, "item not found");
  const { item } = stored;
  if (item.source !== "github-pr") throw new PrActionError(409, "only someone else's pull request takes a comment from the card");
  const text = body.trim();
  if (!text || text.length > MAX_BODY) throw new PrActionError(409, "the comment is empty or too long");
  const number = Number(item.externalId.split("#")[1]);
  const posted = await postReply(deps.exec, { number, url: item.externalUrl }, { body: text });
  if (!posted.ok) throw new PrActionError(502, posted.error);
  return deps.writer.commit(prCommented(item, deps.ctx, text));
}
