/** The outcome of a call that changes something at the provider: done, or why not. */
export type Done = { ok: true } | { ok: false; error: string };
