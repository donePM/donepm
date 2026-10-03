export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

export interface SplitDocument {
  frontmatter: string;
  body: string;
}

/** Trivial split at the `---` delimiter lines. The frontmatter block is parsed elsewhere. */
export function splitFrontmatter(source: string): SplitDocument {
  const lines = source.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== "---") throw new FrontmatterError("Missing opening '---' frontmatter delimiter");
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (end === -1) throw new FrontmatterError("Missing closing '---' frontmatter delimiter");
  return { frontmatter: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}
