import { z } from "zod";

/** The backends each provider kind has today (D50). Jira and Azure DevOps come with `api` (#139). */
export const BACKENDS = { github: ["cli"] } as const satisfies Record<string, readonly ("cli" | "api")[]>;

export type ConnectionKind = keyof typeof BACKENDS;
const KINDS = Object.keys(BACKENDS) as [ConnectionKind, ...ConnectionKind[]];

const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/** One provider instance donePM talks to (D50). Its API token, if any, is in the Keychain, never here. */
export const ConnectionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lower case letters, digits and dashes"),
    kind: z.enum(KINDS),
    backend: z.enum(["cli", "api"]).default("cli"),
    host: z.string().trim().toLowerCase().regex(HOST, "a host name like github.acme.com"),
  })
  .strict()
  .refine((c) => (BACKENDS[c.kind] as readonly string[]).includes(c.backend), {
    path: ["backend"],
    message: "this kind has no such backend yet",
  });

export type ConnectionConfig = z.infer<typeof ConnectionSchema>;

/** What donePM has without a `connections` config: github.com through `gh`. */
export const DEFAULT_CONNECTIONS: readonly ConnectionConfig[] = [{ id: "github", kind: "github", backend: "cli", host: "github.com" }];

export const ConnectionsSchema = z
  .array(ConnectionSchema)
  .min(1)
  .superRefine((list, ctx) => {
    for (const field of ["id", "host"] as const) {
      const seen = new Set<string>();
      list.forEach((c, i) => {
        if (seen.has(c[field])) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, field], message: `${field} ${c[field]} is used twice` });
        seen.add(c[field]);
      });
    }
  });

/** The connections of a config: its own list, or the github.com default. */
export function connectionsOf(config: { connections?: readonly ConnectionConfig[] | undefined }): readonly ConnectionConfig[] {
  return config.connections ?? DEFAULT_CONNECTIONS;
}

/** The connection serving an origin's host (`host/owner/repo`), if any. */
export function connectionFor(connections: readonly ConnectionConfig[], origin: string): ConnectionConfig | undefined {
  const host = origin.split("/")[0]?.toLowerCase() ?? "";
  return connections.find((c) => c.host === host);
}
