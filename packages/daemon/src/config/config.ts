import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AGENT_KINDS, DEFAULT_WEB_FETCH_DOMAINS, isDomain, MERGE_METHODS, normalizeOriginUrl } from "@donepm/core";
import { z } from "zod";
import { connectionFor, connectionsOf, ConnectionsSchema } from "./connections.js";

/**
 * Per repository: which issues donePM collects (spec 4.6). `query` is the provider's search
 * string as pasted from its UI; without one the repo gets the default (assigned to me). Only a
 * `managed` repo is polled and shown; an unmanaged one's items are hidden, nothing is deleted (D46).
 */
export const SourceSchema = z
  .object({
    query: z.string().trim().min(1).optional(),
    assignOnStart: z.boolean().default(false),
    /** Playbook new issues of this repository start with, instead of `implement` (issue #127). */
    playbook: z.string().trim().min(1).optional(),
    /**
     * The playbooks each ingest may run here (issue #153). Missing: every playbook that is not
     * read-only for issues, `review` for pull requests (core `allowedPlaybooks`).
     */
    playbooks: z
      .object({
        issue: z.array(z.string().trim().min(1)).min(1).optional(),
        pr: z.array(z.string().trim().min(1)).min(1).optional(),
      })
      .strict()
      .optional(),
    /** The coding agent items of this repository run with, unless their playbook names one (D49). */
    agent: z.enum(AGENT_KINDS).optional(),
    /** donePM collects, shows and starts work for this repository only when true (issue #94, D46). */
    managed: z.boolean().optional(),
    /** Default of the per-item "Merge automatically" choice for others' pull requests (D47). Off. */
    autoMerge: z.boolean().optional(),
    /** How donePM merges others' pull requests here, by the card's default and by auto-merge (D47). */
    mergeMethod: z.enum(MERGE_METHODS).optional(),
    /** Issue #33's flag, replaced by `managed`; only read once to migrate (D46). */
    ignored: z.boolean().optional(),
  })
  .strict()
  .refine((s) => !s.playbook || !s.playbooks?.issue || s.playbooks.issue.includes(s.playbook), {
    path: ["playbook"],
    message: "the default playbook must be one of the playbooks offered for issues",
  });

export type SourceSettings = z.infer<typeof SourceSchema>;

/** A `sources` key: a normalised origin. Its host needs a connection; `ValidConfigSchema` checks that. */
export const SourceKey = z.string().refine((k) => /^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(k) && normalizeOriginUrl(k) === k, {
  message: "must be a normalised origin like github.com/owner/repo",
});

/** Why an origin cannot be a source or a clone: no connection serves its host (D50). */
export function noConnectionFor(origin: string): string {
  return `no connection for ${origin.split("/")[0]}; add one under "connections"`;
}

export const ConfigSchema = z
  .object({
    port: z.number().int().min(1).max(65535).default(6174),
    repoRoot: z.string().min(1).default("~/Code"),
    worktreeRoot: z.string().min(1).default("~/.local/share/donepm/worktrees"),
    /**
     * Former worktree roots that may still hold worktrees (issue #93). Kept by the daemon, not set
     * through the API: orphan detection looks here too until nothing is left under them.
     */
    previousWorktreeRoots: z.array(z.string().min(1)).default([]),
    branchPrefix: z.string().default("dp/"),
    pollIntervalSeconds: z.number().int().min(10).default(60),
    maxConcurrentAgents: z.number().int().min(1).default(1),
    /** Remove a done item's clean worktree once the PR its draft opened is merged (D33). */
    removeWorktreeOnMerge: z.boolean().default(false),
    /** Hours a finished item stays on the board before it moves to the Archive (D37). */
    archiveAfterHours: z.number().int().min(0).default(24),
    /** Days an archived item is kept before it is deleted with its history (D37). `null`: never. */
    deleteAfterDays: z.number().int().min(0).nullable().default(7),
    /**
     * The providers donePM talks to, read at start (D50). Absent: github.com through `gh`. A
     * change through `PUT /api/settings` applies after a restart.
     */
    connections: ConnectionsSchema.optional(),
    /** Keyed by normalised origin. Replaced as a whole by `PUT /api/settings`; `PUT /api/repos/:id` changes one entry. */
    sources: z.record(SourceKey, SourceSchema).default({}),
    /** WebFetch to these hosts (and their subdomains) is allowed by the daemon, not asked (D31). */
    allowedWebFetchDomains: z
      .array(z.string().trim().toLowerCase().refine(isDomain, { message: "must be a host name like docs.github.com" }))
      .default([...DEFAULT_WEB_FETCH_DOMAINS]),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

/** The config with what spans its keys checked: every `sources` key has a connection for its host. */
export const ValidConfigSchema = ConfigSchema.superRefine((config, ctx) => {
  const connections = connectionsOf(config);
  for (const origin of Object.keys(config.sources)) {
    if (!connectionFor(connections, origin)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", origin], message: noConnectionFor(origin) });
  }
});

export const DEFAULT_CONFIG: Config = ValidConfigSchema.parse({});

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
  const result = ValidConfigSchema.safeParse(raw);
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
