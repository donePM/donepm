import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_WEB_FETCH_DOMAINS, isDomain, normalizeOriginUrl } from "@donepm/core";
import { z } from "zod";

/** Hosts donePM can run a source query against. GitLab and Jira come later (issue #32). */
export const SOURCE_PROVIDERS = { "github.com": "github" } as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[keyof typeof SOURCE_PROVIDERS];

/** The provider for a normalised origin (`github.com/owner/repo`), or undefined if unsupported. */
export function providerOf(origin: string): SourceProvider | undefined {
  const host = origin.split("/")[0] ?? "";
  return Object.hasOwn(SOURCE_PROVIDERS, host) ? SOURCE_PROVIDERS[host as keyof typeof SOURCE_PROVIDERS] : undefined;
}

/**
 * Per repository: which issues donePM collects (spec 4.6). `query` is the provider's search
 * string as pasted from its UI; without one the repo gets the default (assigned to me).
 */
export const SourceSchema = z
  .object({
    query: z.string().trim().min(1).optional(),
    assignOnStart: z.boolean().default(false),
  })
  .strict();

export type SourceSettings = z.infer<typeof SourceSchema>;

/** A `sources` key: normalised origin of a supported provider. */
export const SourceKey = z
  .string()
  .refine((k) => /^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(k) && normalizeOriginUrl(k) === k, {
    message: "must be a normalised origin like github.com/owner/repo",
  })
  .refine((k) => providerOf(k) !== undefined, { message: "only github.com repositories are supported for now" });

export const ConfigSchema = z
  .object({
    port: z.number().int().min(1).max(65535).default(6174),
    repoRoot: z.string().min(1).default("~/Code"),
    worktreeRoot: z.string().min(1).default("~/.local/share/donepm/worktrees"),
    branchPrefix: z.string().default("dp/"),
    pollIntervalSeconds: z.number().int().min(10).default(60),
    maxConcurrentAgents: z.number().int().min(1).default(1),
    /** Remove a done item's clean worktree once the PR its draft opened is merged (D33). */
    removeWorktreeOnMerge: z.boolean().default(false),
    /** Keyed by normalised origin. Replaced as a whole by `PUT /api/settings`. */
    sources: z.record(SourceKey, SourceSchema).default({}),
    /** WebFetch to these hosts (and their subdomains) is allowed by the daemon, not asked (D31). */
    allowedWebFetchDomains: z
      .array(z.string().trim().toLowerCase().refine(isDomain, { message: "must be a host name like docs.github.com" }))
      .default([...DEFAULT_WEB_FETCH_DOMAINS]),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/** Parse and validate config JSON. Missing keys get their defaults. */
export function parseConfig(text: string, file = "config"): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${file}: not valid JSON: ${(e as Error).message}`, { cause: e });
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ConfigError(`${file}: ${detail}`);
  }
  return result.data;
}

/** Load the config file, creating it with defaults on first start. */
export async function loadConfig(file: string): Promise<{ config: Config; created: boolean }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    await saveConfig(file, DEFAULT_CONFIG);
    return { config: DEFAULT_CONFIG, created: true };
  }
  return { config: parseConfig(text, file), created: false };
}

export async function saveConfig(file: string, config: Config): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}
