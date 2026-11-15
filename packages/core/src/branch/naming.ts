export const MAX_BRANCH_LENGTH = 60;

const TRANSLITERATIONS: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ł: "l", þ: "th",
};

/** Lower-case ASCII slug: umlauts transliterated, accents stripped, other runs become `-`. */
export function slugify(text: string): string {
  const mapped = text
    .toLowerCase()
    .replace(/[äöüßæœøđłþ]/g, (c) => TRANSLITERATIONS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  return mapped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface BranchNameInput {
  prefix: string;
  /** The issue's number, or a ticket's key (`APP-123`, issue #139): `workRef`. */
  issueNumber: number | string;
  title: string;
  /** Branches that already exist; a `-2`, `-3`, ... suffix avoids them. */
  existing?: Iterable<string>;
  maxLength?: number;
}

/** `<prefix><issue-number>-<slug>` (`dp/APP-123-<slug>` for a ticket), at most `maxLength` (60) chars including prefix and suffix. */
export function branchName(input: BranchNameInput): string {
  const max = input.maxLength ?? MAX_BRANCH_LENGTH;
  const taken = new Set(input.existing ?? []);
  const head = `${input.prefix}${input.issueNumber}`;
  const slug = slugify(input.title);

  const build = (suffix: string): string => {
    const room = max - head.length - suffix.length;
    // Room for "-" + at least one slug char, otherwise drop the slug.
    const cut = room >= 2 && slug ? slug.slice(0, room - 1).replace(/-+$/, "") : "";
    return `${head}${cut ? `-${cut}` : ""}${suffix}`;
  };

  let candidate = build("");
  for (let n = 2; taken.has(candidate); n++) candidate = build(`-${n}`);
  return candidate;
}
