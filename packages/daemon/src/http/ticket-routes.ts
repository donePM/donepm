import type { WorkItem } from "@donepm/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_JQL } from "../config/ticket-sources.js";
import { RepoChoiceError } from "../items/repo-choice.js";
import type { Providers } from "../providers/registry.js";

export interface TicketRouteDeps {
  /** The connections in use; one saved since starts after a restart. */
  providers: Providers;
  /** Throws RepoChoiceError. */
  chooseRepo: (itemId: string, origin: string) => WorkItem;
  view: (item: WorkItem) => unknown;
}

const RepoChoiceSchema = z.object({ origin: z.string().min(1) }).strict();
const TicketTestSchema = z.object({ connection: z.string().min(1), query: z.string().trim().optional() }).strict();

/** How many of a tested query's tickets Settings lists. */
const SAMPLE = 10;

/**
 * Tickets from a ticket provider (issue #139): the user's pick of a ticket's repository, and
 * Settings' Test of a ticket source's query, which runs the query once and shows what it finds.
 */
export function ticketRoutes(app: FastifyInstance, deps: TicketRouteDeps): void {
  app.post<{ Params: { id: string } }>("/api/items/:id/repo", async (req, reply) => {
    const body = RepoChoiceSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {origin: string}" });
    try {
      return deps.view(deps.chooseRepo(req.params.id, body.data.origin));
    } catch (e) {
      if (e instanceof RepoChoiceError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.post("/api/ticket-sources/test", async (req, reply) => {
    const body = TicketTestSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "body must be {connection: string, query?: string}" });
    const { connection, query } = body.data;
    const source = deps.providers.connections.find((c) => c.id === connection)?.ticketSource;
    if (!source) return reply.code(409).send({ error: `${connection} is not in use yet: restart the daemon after saving it` });
    const r = await source.query("", query || DEFAULT_JQL);
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      count: r.issues.length,
      issues: r.issues.slice(0, SAMPLE).map((i) => ({ externalId: i.externalId, title: i.title, url: i.url })),
    };
  });
}
