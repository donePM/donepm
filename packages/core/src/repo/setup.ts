import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { RepoSetup } from "./types.js";

const nonEmpty = z.string().trim().min(1);

const RepoSetupSchema = z
  .object({
    dependencies: z.enum(["auto", "off"]).optional(),
    copy: z.array(nonEmpty).optional(),
    run: z.array(nonEmpty).optional(),
  })
  .strict();

export class RepoSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepoSetupError";
  }
}

/** Parse `.donepm/setup.yml` (spec 7.3). An empty file means no setup. */
export function parseRepoSetup(source: string): RepoSetup {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    throw new RepoSetupError(`Invalid setup.yml: ${(e as Error).message}`, { cause: e });
  }
  if (raw === null || raw === undefined) return {};
  const result = RepoSetupSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new RepoSetupError(`Invalid setup.yml: ${detail}`);
  }
  for (const path of result.data.copy ?? []) {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new RepoSetupError(`Invalid setup.yml: copy path "${path}" must stay inside the repository`);
    }
  }
  const setup: RepoSetup = {};
  if (result.data.dependencies) setup.dependencies = result.data.dependencies;
  if (result.data.copy) setup.copy = result.data.copy;
  if (result.data.run) setup.run = result.data.run;
  return setup;
}
