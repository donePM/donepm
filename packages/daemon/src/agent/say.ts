import type { WorkItem } from "@donepm/core";

export class SayError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "SayError";
  }
}

export interface SayDeps {
  item: (id: string) => WorkItem | undefined;
  hasProcess: (id: string) => boolean;
  say: (id: string, text: string) => void;
}

/** The longest note the composer sends; a pasted log should go to a file, not the turn. */
export const MAX_NOTE_LENGTH = 20_000;

/**
 * The composer in the Agents view (spec 12.3): a note from the user that joins the running turn as
 * the agent's next user message. Only while the item runs; a waiting item is answered on its card.
 */
export function sayToAgent(deps: SayDeps, itemId: string, text: string): void {
  const item = deps.item(itemId);
  if (!item) throw new SayError(404, "item not found");
  const note = text.trim();
  if (!note) throw new SayError(400, "the note is empty");
  if (note.length > MAX_NOTE_LENGTH) throw new SayError(400, `the note is longer than ${MAX_NOTE_LENGTH} characters`);
  if (item.state !== "running" || !deps.hasProcess(itemId)) throw new SayError(409, "the agent is not running");
  deps.say(itemId, note);
}
