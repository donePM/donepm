import { GITHUB_COM, qualifiedRepository, type PrStatus } from "@donepm/core";
import { z } from "zod";
import type { PrRef } from "../providers/code-host.js";
import type { Exec } from "../process/exec.js";

/** Pull requests per `gh api graphql` call; each is one aliased `repository` field. */
export const STATUS_BATCH = 50;

/** Owner and repository names are inlined into the query; anything else is not asked. */
const NAME = /^[A-Za-z0-9_.-]+$/;

const PullRequestNode = z
  .object({
    number: z.number().int(),
    state: z.string(),
    closedAt: z.string().nullish(),
    mergeable: z.string(),
    mergeStateStatus: z.string().nullish(),
    headRefOid: z.string().nullish(),
    baseRefName: z.string(),
    reviewDecision: z.string().nullish(),
    viewerLatestReview: z.object({ state: z.string() }).passthrough().nullish(),
    commits: z
      .object({
        nodes: z.array(
          z.object({ commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).passthrough().nullish() }).passthrough() }).passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();
/** `gh api graphql` with one `prN: repository { pullRequest }` per PR. A PR GitHub cannot find is `null`. */
export const PrStatusesSchema = z
  .object({
    data: z.record(z.string(), z.object({ pullRequest: PullRequestNode.nullable() }).passthrough().nullable()).nullish(),
  })
  .passthrough();

export type { PrRef };

const FIELDS =
  "number state closedAt mergeable mergeStateStatus headRefOid reviewDecision viewerLatestReview { state } baseRefName " +
  "commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";

export function prStatusQuery(refs: readonly PrRef[]): string {
  const fields = refs.map((ref, i) => {
    const [owner, name] = ref.repository.split("/");
    return `pr${i}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${ref.number}) { ${FIELDS} } }`;
  });
  return `query { ${fields.join(" ")} }`;
}

const valid = (ref: PrRef): boolean => {
  const parts = ref.repository.split("/");
  return parts.length === 2 && parts.every((p) => NAME.test(p)) && Number.isInteger(ref.number) && ref.number > 0;
};

/**
 * The status of someone else's pull requests (D47) on one GitHub host, keyed by `externalId`
 * (`owner/repo#N` on github.com, `host/owner/repo#N` elsewhere, issue #140). One `gh api graphql`
 * call per 50, by repository and number, so items the searches no longer return (reviewed, done)
 * are read, too. A pull request missing from the map could not be read and keeps what it had.
 */
export async function fetchPrStatuses(exec: Exec, refs: readonly PrRef[], host: string = GITHUB_COM): Promise<Map<string, PrStatus>> {
  const read = new Map<string, PrStatus>();
  const asked = refs.filter(valid);
  for (let i = 0; i < asked.length; i += STATUS_BATCH) {
    const batch = asked.slice(i, i + STATUS_BATCH);
    const r = await exec("gh", ["api", "graphql", "--hostname", host, "-f", `query=${prStatusQuery(batch)}`]);
    let parsed: z.infer<typeof PrStatusesSchema> | undefined;
    try {
      const result = PrStatusesSchema.safeParse(JSON.parse(r.stdout));
      if (result.success) parsed = result.data;
    } catch {
      // gh failed without a body: nothing of this batch was read.
    }
    // gh exits 1 when one pull request is not found, but answers for all the others.
    batch.forEach((ref, n) => {
      const pr = parsed?.data?.[`pr${n}`]?.pullRequest;
      if (!pr) return;
      const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.state;
      read.set(`${qualifiedRepository(host, ref.repository)}#${ref.number}`, {
        state: pr.state,
        ...(pr.closedAt ? { closedAt: pr.closedAt } : {}),
        mergeable: pr.mergeable,
        ...(pr.mergeStateStatus ? { mergeState: pr.mergeStateStatus } : {}),
        ...(pr.headRefOid ? { head: pr.headRefOid } : {}),
        base: pr.baseRefName,
        ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
        ...(pr.viewerLatestReview ? { viewerReview: pr.viewerLatestReview.state } : {}),
        ...(checks ? { checks } : {}),
      });
    });
  }
  return read;
}
