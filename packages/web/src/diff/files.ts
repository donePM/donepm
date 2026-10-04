import { parsePatch } from "diff";

export type LineKind = "add" | "del" | "ctx" | "meta";

export interface DiffLine {
  kind: LineKind;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  /** Set for renames. */
  oldPath?: string;
  status: "added" | "deleted" | "renamed" | "modified";
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` stays empty. */
function stripPrefix(name: string | undefined): string {
  if (!name || name === "/dev/null") return "";
  return name.replace(/^[ab]\//, "");
}

const KIND: Record<string, LineKind> = { "+": "add", "-": "del", " ": "ctx" };

/** Files of a `git diff` patch, in the order git printed them. */
export function diffFiles(patch: string): DiffFile[] {
  if (!patch.trim()) return [];
  return parsePatch(patch).map((p) => {
    const oldPath = stripPrefix(p.oldFileName);
    const newPath = stripPrefix(p.newFileName);
    const status = p.isCreate || !oldPath ? "added" : p.isDelete || !newPath ? "deleted" : p.isRename || oldPath !== newPath ? "renamed" : "modified";
    let additions = 0;
    let deletions = 0;
    const hunks = p.hunks.map((h) => ({
      header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      lines: h.lines.map((l) => {
        const kind = KIND[l[0] ?? ""] ?? "meta";
        if (kind === "add") additions++;
        if (kind === "del") deletions++;
        return { kind, text: kind === "meta" ? l : l.slice(1) };
      }),
    }));
    return {
      path: newPath || oldPath,
      ...(status === "renamed" ? { oldPath } : {}),
      status,
      binary: p.isBinary === true,
      additions,
      deletions,
      hunks,
    };
  });
}

export function diffStats(files: readonly DiffFile[]): DiffStats {
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}

type Keyed = { path: string; oldPath?: string };

/** Stable identity of a file within one diff (renames include the old path). */
export function fileKey(f: Keyed): string {
  return `${f.oldPath ?? ""}→${f.path}`;
}

/** Every file open. */
export function expandAll(files: readonly Keyed[]): Set<string> {
  return new Set(files.map(fileKey));
}

/** Every file closed. */
export function collapseAll(): Set<string> {
  return new Set();
}

/** A copy of `open` with `key` flipped. */
export function toggleKey(open: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function allOpen(files: readonly Keyed[], open: ReadonlySet<string>): boolean {
  return files.length > 0 && files.every((f) => open.has(fileKey(f)));
}

export function noneOpen(files: readonly Keyed[], open: ReadonlySet<string>): boolean {
  return !files.some((f) => open.has(fileKey(f)));
}
