import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Resolves symlinks (`/var` → `/private/var` on macOS) so git's paths and ours compare. */
export function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** `path` lies inside `root` (not the root itself), after resolving symlinks of both. */
export function isUnder(path: string, root: string): boolean {
  return real(path).startsWith(withSep(real(root)));
}

/** The same directory, after resolving symlinks. */
export const sameDir = (a: string, b: string) => real(a) === real(b);

const withSep = (p: string) => (p.endsWith(sep) ? p : p + sep);
