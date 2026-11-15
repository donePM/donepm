import { describe, expect, it } from "vitest";
import type { SourceIssue } from "@donepm/core";
import type { TicketRef, TicketSource } from "../../providers/ticket-source.js";

/**
 * What an adapter's test supplies to run the ticket source contract (issue #138). `answering` is
 * backed by a provider that answers every call with the adapter's recorded fixtures; `failing` by
 * one that refuses every call (logged out, revoked token, host down).
 */
export interface TicketSourceScenarios {
  answering(): TicketSource;
  failing(): TicketSource;
  /** An open ticket the answering provider knows. */
  ticket: TicketRef;
  /** A repository and a query its answering provider has tickets for. */
  origin: string;
  query: string;
  /** What the answering provider's default searches bring, in order, by `repository#number`. */
  collected: string[];
}

const key = (i: SourceIssue): string => `${i.repository}#${i.number}`;

function isSourceIssue(i: SourceIssue): void {
  expect(i.repository).toMatch(/\S/);
  expect(Number.isInteger(i.number)).toBe(true);
  expect(() => new URL(i.url)).not.toThrow();
  expect(typeof i.title).toBe("string");
  expect(typeof i.body).toBe("string");
  expect(Array.isArray(i.labels)).toBe(true);
  expect(Number.isNaN(Date.parse(i.createdAt))).toBe(false);
}

/** The contract every `TicketSource` meets, whatever its backend. */
export function ticketSourceContract(name: string, s: TicketSourceScenarios): void {
  describe(`${name}: TicketSource contract`, () => {
    describe("when the provider answers", () => {
      it("collects the default searches, the main one first and without a label", async () => {
        const searches = await s.answering().collect(() => [s.origin]);
        expect(searches.length).toBeGreaterThan(0);
        expect(searches[0]!.label).toBeUndefined();
        for (const search of searches.slice(1)) expect(search.label).toMatch(/\S/);
        const issues = searches.flatMap((x) => (x.result.ok ? x.result.issues : []));
        expect(searches.every((x) => x.result.ok)).toBe(true);
        issues.forEach(isSourceIssue);
        expect(issues.map(key)).toEqual(s.collected);
      });

      it("answers a repository's query with tickets of that repository", async () => {
        const r = await s.answering().query(s.origin, s.query);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.issues.length).toBeGreaterThan(0);
        r.issues.forEach(isSourceIssue);
      });

      it("keeps every ticket and its order when it adds the fields", async () => {
        const source = s.answering();
        const issues = (await source.collect(() => [s.origin])).flatMap((x) => (x.result.ok ? x.result.issues : []));
        const read = await source.withFields(issues);
        expect(read.map(key)).toEqual(issues.map(key));
        for (const i of read) expect(i).not.toHaveProperty("nodeId");
      });

      it("reads an open ticket as OPEN and assigns it", async () => {
        expect(await s.answering().state(s.ticket)).toBe("OPEN");
        expect(await s.answering().assignToMe(s.ticket)).toEqual({ ok: true });
      });
    });

    describe("when the provider refuses", () => {
      it("reports the main search as a failed command, without throwing", async () => {
        const [main] = await s.failing().collect(() => [s.origin]);
        expect(main!.result).toMatchObject({ ok: false, kind: "command" });
        if (!main!.result.ok) expect(main!.result.error).toMatch(/\S/);
      });

      it("reports a failed query with the reason", async () => {
        const r = await s.failing().query(s.origin, s.query);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/\S/);
      });

      it("keeps the tickets when their fields cannot be read", async () => {
        const issues = (await s.answering().collect(() => [s.origin])).flatMap((x) => (x.result.ok ? x.result.issues : []));
        expect((await s.failing().withFields(issues)).map(key)).toEqual(issues.map(key));
      });

      it("has no state for a ticket and fails to assign it with the reason", async () => {
        expect(await s.failing().state(s.ticket)).toBeUndefined();
        const r = await s.failing().assignToMe(s.ticket);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/\S/);
      });
    });
  });
}
