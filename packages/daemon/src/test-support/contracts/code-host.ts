import { describe, expect, it } from "vitest";
import type { CiPr, ReviewDraftPayload } from "@donepm/core";
import type { CodeHost, PrCreate, PrRef } from "../../providers/code-host.js";

/** The parts of a code host a provider may not have yet: someone else's PRs, reviews, feedback. */
export type OptionalCodeHostPart = "prStatuses" | "prFeedback" | "reply" | "postReview" | "merge" | "updateBranch";

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
  /**
   * What the provider does not do yet (issue #141). Reading the feedback then gives none and the
   * statuses none; every write fails with a reason that says it is not supported, without a call.
   */
  unsupported?: readonly OptionalCodeHostPart[];
}

function failsWithReason(r: { ok: boolean; error?: string }): void {
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/\S/);
}

/** The contract every `CodeHost` meets, whatever its backend. */
export function codeHostContract(name: string, s: CodeHostScenarios): void {
  const has = (part: OptionalCodeHostPart) => !s.unsupported?.includes(part);
  const supported = (part: OptionalCodeHostPart) => (has(part) ? it : it.skip);
  describe(`${name}: CodeHost contract`, () => {
    if (s.unsupported?.length) {
      it("says what it does not support, without guessing", async () => {
        const host = s.answering();
        for (const part of s.unsupported ?? []) {
          if (part === "prStatuses") expect((await host.prStatuses(s.statuses)).size).toBe(0);
          else if (part === "prFeedback") expect(await host.prFeedback(s.pr)).toEqual({ ok: true, entries: [] });
          else {
            const r = part === "reply" ? await host.reply(s.pr, { body: "Thanks!" })
              : part === "postReview" ? await host.postReview(s.review)
                : part === "merge" ? await host.merge(s.pr, "squash")
                  : await host.updateBranch(s.pr);
            expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/not supported/) });
          }
        }
      });
    }

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

      supported("prStatuses")("reads someone else's pull requests, keyed owner/repo#N", async () => {
        const read = await s.answering().prStatuses(s.statuses);
        expect([...read].map(([k, v]) => [k, v.state])).toEqual(s.statuses.map((r) => [`${r.repository}#${r.number}`, r.state]));
        for (const v of read.values()) expect(v.mergeable).toMatch(/\S/);
      });

      supported("prFeedback")("reads the review feedback, oldest first", async () => {
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

      supported("reply")("replies in a thread and in the conversation, and says where", async () => {
        for (const reply of [{ body: "Done.", inReplyTo: s.inReplyTo }, { body: "Thanks!" }]) {
          const r = await s.answering().reply(s.pr, reply);
          expect(r.ok).toBe(true);
          if (r.ok) expect(() => new URL(r.url)).not.toThrow();
        }
      });

      supported("postReview")("posts a review and says where", async () => {
        const r = await s.answering().postReview(s.review);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.result.id).toBeGreaterThan(0);
      });

      supported("merge")("merges", async () => {
        expect(await s.answering().merge(s.pr, "squash")).toEqual({ ok: true });
      });

      supported("updateBranch")("updates the branch", async () => {
        expect(await s.answering().updateBranch(s.pr)).toEqual({ ok: true });
      });
    });

    describe("when the provider refuses", () => {
      it("fails every write with the reason, without throwing", async () => {
        const host = s.failing();
        failsWithReason(await host.clone(s.origin, "/tmp/donepm-contract/clone"));
        failsWithReason(await host.createPr(s.create));
        if (has("reply")) failsWithReason(await host.reply(s.pr, { body: "Done.", inReplyTo: s.inReplyTo }));
        if (has("reply")) failsWithReason(await host.reply(s.pr, { body: "Thanks!" }));
        if (has("postReview")) failsWithReason(await host.postReview(s.review));
        if (has("merge")) failsWithReason(await host.merge(s.pr, "squash"));
        if (has("updateBranch")) failsWithReason(await host.updateBranch(s.pr));
      });

      it("fails every read with the reason; statuses it could not read are missing", async () => {
        const host = s.failing();
        failsWithReason(await host.prState(s.pr));
        if (has("prFeedback")) failsWithReason(await host.prFeedback(s.pr));
        expect((await host.prStatuses(s.statuses)).size).toBe(0);
      });
    });
  });
}
