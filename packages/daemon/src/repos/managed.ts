import type { ItemState } from "@donepm/core";
import type { Config } from "../config/config.js";

/** The user chose to manage this repository (by normalised origin) with donePM (issue #94, D46). */
export function isManaged(sources: Config["sources"], origin: string): boolean {
  return sources[origin]?.managed === true;
}

/** Every managed origin. */
export function managedOrigins(sources: Config["sources"]): Set<string> {
  return new Set(Object.keys(sources).filter((origin) => isManaged(sources, origin)));
}

/**
 * The sources map with one origin's `managed` flag set, the other origins and fields untouched.
 * Unmanaging keeps the entry with `managed: false`: an explicit choice is never migrated again.
 */
export function withManaged(sources: Config["sources"], origin: string, managed: boolean): Config["sources"] {
  const { ignored: _legacy, ...kept } = sources[origin] ?? { assignOnStart: false };
  return { ...sources, [origin]: { ...kept, managed } };
}

/** Origins whose managed flag differs between two configs. */
export function managedChanges(prev: Config["sources"], next: Config["sources"]): string[] {
  const before = managedOrigins(prev);
  const after = managedOrigins(next);
  return [...new Set([...before, ...after])].filter((origin) => before.has(origin) !== after.has(origin));
}

/**
 * D46: the first start that knows `managed` keeps what the user worked with. Every origin that has
 * items or a source entry becomes managed, except one ignored under issue #33, which becomes
 * unmanaged. Undefined when there is nothing to migrate: some origin already has the flag, or there
 * is no origin at all (a fresh install starts with nothing managed).
 */
export function migrateManaged(sources: Config["sources"], itemOrigins: Iterable<string>): Config["sources"] | undefined {
  if (Object.values(sources).some((s) => s.managed !== undefined)) return undefined;
  const origins = new Set([...itemOrigins, ...Object.keys(sources)]);
  if (origins.size === 0) return undefined;
  const next: Config["sources"] = {};
  for (const origin of origins) {
    const { ignored, ...kept } = sources[origin] ?? { assignOnStart: false };
    next[origin] = { ...kept, managed: ignored !== true };
  }
  return next;
}

/** Items in these states need the user, or an agent is working on them, so they never leave the board. */
const ATTENTION_STATES: ReadonlySet<ItemState> = new Set(["running", "needs_you"]);

/**
 * Whether the board hides an item because its repository is not managed. Items that are running or
 * waiting on the user stay, as does anything with an unanswered ask or an unapproved draft;
 * `hasPending` is only called for the remaining items of unmanaged repositories.
 */
export function hiddenUnmanaged(input: { managed: boolean; state: ItemState; hasPending: () => boolean }): boolean {
  if (input.managed || ATTENTION_STATES.has(input.state)) return false;
  return !input.hasPending();
}
