import { z } from "zod";

/** The backends each provider kind has today (D50). */
export const BACKENDS = { github: ["cli"], jira: ["api"] } as const satisfies Record<string, readonly ("cli" | "api")[]>;

export type ConnectionKind = keyof typeof BACKENDS;

/** Kinds whose repositories and pull requests live on a host, found by an origin's host. */
const CODE_HOST_KINDS: readonly ConnectionKind[] = ["github"];

const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lower case letters, digits and dashes");
const Backend = z.enum(["cli", "api"]);

const GitHubConnectionSchema = z
  .object({
    id: Id,
    kind: z.literal("github"),
    backend: Backend.default("cli"),
    host: z.string().trim().toLowerCase().regex(HOST, "a host name like github.acme.com"),
  })
  .strict();

/** `https://acme.atlassian.net` or `https://jira.acme.com/jira`: https, no query, no trailing slash. */
const BaseUrl = z
  .string()
  .trim()
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && !u.search && !u.hash && !u.username && !u.password && HOST.test(u.host);
    } catch {
      return false;
    }
  }, "an https URL like https://acme.atlassian.net")
  .transform((s) => {
    const u = new URL(s);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  });

/**
 * Jira over its REST API (D51). Cloud signs in with the account's email and an API token, Data
 * Center with a personal access token; the token is in the Keychain under the connection's id.
 */
const JiraConnectionSchema = z
  .object({
    id: Id,
    kind: z.literal("jira"),
    backend: Backend.default("api"),
    baseUrl: BaseUrl,
    deployment: z.enum(["cloud", "datacenter"]),
    /** The Atlassian account the Cloud API token belongs to. Data Center does not use it. */
    email: z.string().trim().email().optional(),
  })
  .strict();

/** One provider instance donePM talks to (D50). Its API token, if any, is in the Keychain, never here. */
export const ConnectionSchema = z
  .discriminatedUnion("kind", [GitHubConnectionSchema, JiraConnectionSchema])
  .superRefine((c, ctx) => {
    if (!(BACKENDS[c.kind] as readonly string[]).includes(c.backend)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backend"], message: "this kind has no such backend yet" });
    }
    if (c.kind === "jira" && c.deployment === "cloud" && !c.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Jira Cloud needs the email of the account the API token belongs to" });
    }
  });

export type ConnectionConfig = z.infer<typeof ConnectionSchema>;
export type GitHubConnectionConfig = Extract<ConnectionConfig, { kind: "github" }>;
export type JiraConnectionConfig = Extract<ConnectionConfig, { kind: "jira" }>;

/** What donePM has without a `connections` config: github.com through `gh`. */
export const DEFAULT_CONNECTIONS: readonly ConnectionConfig[] = [{ id: "github", kind: "github", backend: "cli", host: "github.com" }];

/** The host a connection talks to: its own for a code host, its base URL's for an API. */
export function connectionHost(c: ConnectionConfig): string {
  return c.kind === "github" ? c.host : new URL(c.baseUrl).host.toLowerCase();
}

export const ConnectionsSchema = z
  .array(ConnectionSchema)
  .min(1)
  .superRefine((list, ctx) => {
    const fields = { id: (c: ConnectionConfig) => c.id, host: connectionHost };
    for (const [field, of] of Object.entries(fields)) {
      const seen = new Set<string>();
      list.forEach((c, i) => {
        const value = of(c);
        const path = field === "host" && c.kind !== "github" ? "baseUrl" : field;
        if (seen.has(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, path], message: `${field} ${value} is used twice` });
        seen.add(value);
      });
    }
  });

/** The connections of a config: its own list, or the github.com default. */
export function connectionsOf(config: { connections?: readonly ConnectionConfig[] | undefined }): readonly ConnectionConfig[] {
  return config.connections ?? DEFAULT_CONNECTIONS;
}

/** The code host connection serving an origin's host (`host/owner/repo`), if any. */
export function connectionFor(connections: readonly ConnectionConfig[], origin: string): ConnectionConfig | undefined {
  const host = origin.split("/")[0]?.toLowerCase() ?? "";
  return connections.find((c) => CODE_HOST_KINDS.includes(c.kind) && connectionHost(c) === host);
}
