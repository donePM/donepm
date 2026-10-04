import { describe, expect, it } from "vitest";
import type { CiPr, ReviewDraftPayload } from "@donepm/core";
import type { CodeHost, PrCreate, PrRef } from "../../providers/code-host.js";

/** What an adapter's test supplies to run the code host contract (issue #138). */
export interface CodeHostScenarios {
  /** Answers every call; the pull request `pr` is open. */
  answering(): CodeHost;
  /** Refuses every call. */
  failing(): CodeHost;
  origin: string;
  create: PrCreate;
  /** The pull request `create` opens. */
  created: CiPr;
  pr: CiPr;
  /** Someone else's pull requests the answering provider knows, with the state of each. */
  statuses: Array<PrRef & { state: string }>;
  /** An inline comment of `pr` to reply to. */
  inReplyTo: number;
  review: ReviewDraftPayload;
}

function failsWithReason(r: { ok: boolean; error?: string }): void {
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/\S/);
}

/** The contract every `CodeHost` meets, whatever its backend. */
export function codeHostContract(name: string, s: CodeHostScenarios): void {
  describe(`${name}: CodeHost contract`, () => {
    describe("when the provider answers", () => {
      it("clones a repository", async () => {
        expect(await s.answering().clone(s.origin, "/tmp/donepm-contract/clone")).toEqual({ ok: true });
      });

      it("opens a pull request and names it by URL and number", async () => {
        expect(await s.answering().createPr(s.create)).toEqual({ ok: true, pr: s.created });
      });

      it("reads where a pull request stands", async () => {
        const r = await s.answering().prState(s.pr);
        expect(r).toMatchObject({ ok: true, state: "OPEN", mergedAt: null });
      });

      it("reads someone else's pull requests, keyed owner/repo#N", async () => {
        const read = await s.answering().prStatuses(s.statuses);
        expect([...read].map(([k, v]) => [k, v.state])).toEqual(s.statuses.map((r) => [`${r.repository}#${r.number}`, r.state]));
        for (const v of read.values()) expect(v.mergeable).toMatch(/\S/);
      });

      it("reads the review feedback, oldest first", async () => {
        const r = await s.answering().prFeedback(s.pr);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.entries.length).toBeGreaterThan(0);
        for (const e of r.entries) {
          expect(["review", "inline", "comment"]).toContain(e.kind);
          expect(e.author).toMatch(/\S/);
        }
        const at = r.entries.map((e) => e.at);
        expect(at).toEqual([...at].sort());
      });

      it("replies in a thread and in the conversation, and says where", async () => {
        for (const reply of [{ body: "Done.", inReplyTo: s.inReplyTo }, { body: "Thanks!" }]) {
          const r = await s.answering().reply(s.pr, reply);
          expect(r.ok).toBe(true);
          if (r.ok) expect(() => new URL(r.url)).not.toThrow();
        }
      });

      it("posts a review and says where", async () => {
        const r = await s.answering().postReview(s.review);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.result.id).toBeGreaterThan(0);
      });

      it("merges and updates the branch", async () => {
        expect(await s.answering().merge(s.pr, "squash")).toEqual({ ok: true });
        expect(await s.answering().updateBranch(s.pr)).toEqual({ ok: true });
      });
    });

    describe("when the provider refuses", () => {
      it("fails every write with the reason, without throwing", async () => {
        const host = s.failing();
        failsWithReason(await host.clone(s.origin, "/tmp/donepm-contract/clone"));
        failsWithReason(await host.createPr(s.create));
        failsWithReason(await host.reply(s.pr, { body: "Done.", inReplyTo: s.inReplyTo }));
        failsWithReason(await host.reply(s.pr, { body: "Thanks!" }));
        failsWithReason(await host.postReview(s.review));
        failsWithReason(await host.merge(s.pr, "squash"));
        failsWithReason(await host.updateBranch(s.pr));
      });

      it("fails every read with the reason; statuses it could not read are missing", async () => {
        const host = s.failing();
        failsWithReason(await host.prState(s.pr));
        failsWithReason(await host.prFeedback(s.pr));
        expect((await host.prStatuses(s.statuses)).size).toBe(0);
      });
    });
  });
}
