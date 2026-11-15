import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Config } from "../config/config.js";
import { connectionsOf, type ConnectionConfig } from "../config/connections.js";
import type { ConnectionTest } from "../providers/connection-test.js";
import type { TokenStore } from "../providers/keychain.js";

export interface ConnectionRouteDeps {
  getConfig: () => Config;
  /** The Keychain (D8): the routes write and remove tokens, and say only whether one is set. */
  tokens: TokenStore;
  /** Asks the provider with the connection as saved (Settings' Test button). */
  testConnection: (connection: ConnectionConfig) => Promise<ConnectionTest>;
  /** Detects every connection again, so the status shows a new or removed token. */
  recheck: () => Promise<void>;
}

/** Long enough for any provider's token, short enough to refuse a pasted file. */
const TokenSchema = z.object({ token: z.string().trim().min(1, "the token is empty").max(4096) }).strict();

/**
 * Per connection, by id: set, replace or remove its API token, and test it (D8 as amended, D50).
 * The connection must be in the saved config, so a token can be set before the restart that puts
 * a new connection to use. A token goes into the Keychain and is never sent back.
 */
export function connectionRoutes(app: FastifyInstance, deps: ConnectionRouteDeps): void {
  const find = (id: string, reply: FastifyReply): ConnectionConfig | undefined => {
    const connection = connectionsOf(deps.getConfig()).find((c) => c.id === id);
    if (!connection) void reply.code(404).send({ error: `no connection ${id}` });
    return connection;
  };
  const apiOnly = (connection: ConnectionConfig, reply: FastifyReply): boolean => {
    if (connection.backend === "api") return true;
    void reply.code(400).send({ error: `${connection.id} signs in through its CLI and takes no API token` });
    return false;
  };
  const refresh = () => void deps.recheck().catch(() => undefined);

  app.put<{ Params: { id: string } }>("/api/connections/:id/token", async (req, reply) => {
    const connection = find(req.params.id, reply);
    if (!connection || !apiOnly(connection, reply)) return reply;
    const body = TokenSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "body must be {token: string}" });
    const done = await deps.tokens.write(connection.id, body.data.token);
    if (!done.ok) return reply.code(502).send({ error: done.error });
    refresh();
    return { id: connection.id, tokenSet: true };
  });

  app.delete<{ Params: { id: string } }>("/api/connections/:id/token", async (req, reply) => {
    const connection = find(req.params.id, reply);
    if (!connection || !apiOnly(connection, reply)) return reply;
    const done = await deps.tokens.remove(connection.id);
    if (!done.ok) return reply.code(502).send({ error: done.error });
    refresh();
    return { id: connection.id, tokenSet: false };
  });

  app.post<{ Params: { id: string } }>("/api/connections/:id/test", async (req, reply) => {
    const connection = find(req.params.id, reply);
    if (!connection) return reply;
    const tokenSet = connection.backend === "api" ? { tokenSet: await deps.tokens.has(connection.id) } : {};
    return { id: connection.id, ...tokenSet, ...(await deps.testConnection(connection)) };
  });
}
