import type { ItemState } from "@donepm/core";
import type { Config } from "../config/config.js";

/** The user marked this repository (by normalised origin) as ignored. */
export function isIgnored(sources: Config["sources"], origin: string): boolean {
  return sources[origin]?.ignored === true;
}

/** Every ignored origin. */
export function ignoredOrigins(sources: Config["sources"]): Set<string> {
  return new Set(Object.keys(sources).filter((origin) => isIgnored(sources, origin)));
}

/**
 * The sources map with one origin's `ignored` flag set, the other origins and fields untouched. An
 * entry left with nothing but defaults (no query, no assign, not ignored) is dropped.
 */
export function withIgnored(sources: Config["sources"], origin: string, ignored: boolean): Config["sources"] {
  const { [origin]: old, ...rest } = sources;
  const { ignored: _was, ...kept } = old ?? { assignOnStart: false };
  if (!ignored && !kept.query && !kept.assignOnStart) return rest;
  return { ...rest, [origin]: { ...kept, ...(ignored ? { ignored: true } : {}) } };
}

/** Origins whose ignored flag differs between two configs. */
export function ignoreChanges(prev: Config["sources"], next: Config["sources"]): string[] {
  const before = ignoredOrigins(prev);
  const after = ignoredOrigins(next);
  return [...new Set([...before, ...after])].filter((origin) => before.has(origin) !== after.has(origin));
}

/** Items in these states need the user, or an agent is working on them, so ignoring never hides them. */
const ATTENTION_STATES: ReadonlySet<ItemState> = new Set(["running", "needs_you"]);

/**
 * Whether the board hides an item because its repository is ignored. Items that are running or
 * waiting on the user stay, as does anything with an unanswered ask or an unapproved draft;
 * `hasPending` is only called for the remaining items of ignored repositories.
 */
export function hiddenByIgnore(input: { ignored: boolean; state: ItemState; hasPending: () => boolean }): boolean {
  if (!input.ignored || ATTENTION_STATES.has(input.state)) return false;
  return !input.hasPending();
}
