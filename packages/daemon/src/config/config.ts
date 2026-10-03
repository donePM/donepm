import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const ConfigSchema = z
  .object({
    port: z.number().int().min(1).max(65535).default(6174),
    repoRoot: z.string().min(1).default("~/Code"),
    worktreeRoot: z.string().min(1).default("~/.local/share/donepm/worktrees"),
    branchPrefix: z.string().default("dp/"),
    pollIntervalSeconds: z.number().int().min(10).default(60),
    maxConcurrentAgents: z.number().int().min(1).default(1),
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
