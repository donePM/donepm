import { isAzureRun, parseAzureBuildLink, type CheckLog, type CiPr, type FailedCheck } from "@donepm/core";
import type { CiSource } from "../providers/ci-source.js";
import { noConnection, type Providers } from "../providers/registry.js";
import type { Done } from "../providers/result.js";

/**
 * The CI of one pull request (issue #143, D53). Its code host's CI source is the one authority for
 * the checks, so a build is never read from two sides. A failed check that links to an Azure
 * Pipelines build gets its log and rerun from the Azure DevOps connection serving that build's
 * organization, whatever hosts the pull request; every other one from the host's CI source.
 * Undefined when no connection serves the pull request.
 */
export function ciSourceFor(providers: Providers, prUrl: string): CiSource | undefined {
  const host = providers.ciSource(prUrl);
  if (!host) return undefined;
  /** The source of a link or run; undefined when no connection serves its Azure DevOps organization. */
  const sourceOf = (where: string | undefined): CiSource | undefined => (where && parseAzureBuildLink(where) ? providers.ciSource(where) : host);

  return {
    checks: (pr) => host.checks(pr),

    async failedLogs(pr: CiPr, failed: readonly FailedCheck[]): Promise<CheckLog[]> {
      const bySource = new Map<CiSource, FailedCheck[]>();
      for (const c of failed) {
        const source = sourceOf(c.link);
        if (source) bySource.set(source, [...(bySource.get(source) ?? []), c]);
      }
      const logs = (await Promise.all([...bySource].map(([source, checks]) => source.failedLogs(pr, checks)))).flat();
      const order = new Map(failed.map((c, i) => [c.name, i]));
      return logs.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    },

    /** Each run by its own source, in order; the first failure stops (D35). */
    async rerunFailed(pr: CiPr, runs: readonly string[]): Promise<Done> {
      for (const run of runs) {
        const source = isAzureRun(run) ? providers.ciSource(run) : host;
        if (!source) return { ok: false, error: noConnection(run) };
        const done = await source.rerunFailed(pr, [run]);
        if (!done.ok) return done;
      }
      return { ok: true };
    },
  };
}
