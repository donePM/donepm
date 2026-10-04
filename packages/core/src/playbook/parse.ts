import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { splitFrontmatter } from "./split.js";
import { PlaybookFrontmatterSchema, type Playbook } from "./schema.js";

export class PlaybookParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlaybookParseError";
  }
}

/** Parse a playbook file: frontmatter validated with zod, the rest is the body template. */
export function parsePlaybook(source: string): Playbook {
  let fm;
  let body;
  try {
    const doc = splitFrontmatter(source);
    body = doc.body;
    fm = parseYaml(doc.frontmatter);
  } catch (e) {
    throw new PlaybookParseError(`Invalid playbook frontmatter: ${(e as Error).message}`, { cause: e });
  }

  let data;
  try {
    data = PlaybookFrontmatterSchema.parse(fm);
  } catch (e) {
    if (e instanceof ZodError) {
      const detail = e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new PlaybookParseError(`Invalid playbook: ${detail}`, { cause: e });
    }
    throw e;
  }

  if (body.trim() === "") throw new PlaybookParseError("Invalid playbook: body is empty");

  const playbook: Playbook = {
    name: data.name,
    model: data.model,
    permissionMode: data.permission_mode,
    drafts: data.drafts,
    body,
  };
  if (data.effort !== undefined) playbook.effort = data.effort;
  if (data.read_only) playbook.readOnly = true;
  if (data.match !== undefined) playbook.match = data.match;
  return playbook;
}
