import { stripVTControlCharacters } from "node:util";
import {
  azureBuildBucket, azureBuildUrl, azurePolicyBucket, parseAzureBuildLink, parseAzurePrUrl,
  type AzureBuild, type CheckLog, type CiCheck, type CiPr, type FailedCheck,
} from "@donepm/core";
import { z } from "zod";
import { parseJson } from "../gh/issues.js";
import { LOG_TAIL_LINES } from "../gh/pr-checks.js";
import type { BranchRuns, CiSource, PrChecks } from "../providers/ci-source.js";
import type { Done } from "../providers/result.js";
import { seg, type AzureTransport } from "./transport.js";

/** Policy types whose evaluations are CI (issue #143): build validation and status checks. Reviewer policies are review. */
export const BUILD_POLICY = "0609b952-1397-4640-95ec-e00a01b2c241";
export const STATUS_POLICY = "cbdc66da-9728-4af8-aada-9a5a32e4a226";

/** The policy evaluations API is still a preview at 7.1. */
const POLICY_API_VERSION = "7.1-preview.1";

const text = z.string().nullish();

const PullRequestSchema = z.object({ repository: z.object({ project: z.object({ id: z.string() }) }) });

const EvaluationsSchema = z.object({
  value: z.array(
    z.object({
      status: z.string(),
      startedDate: text,
      completedDate: text,
      configuration: z.object({
        isEnabled: z.boolean().nullish(),
        type: z.object({ id: z.string(), displayName: text }),
        settings: z.record(z.unknown()).nullish(),
      }),
      context: z.record(z.unknown()).nullish(),
    }),
  ),
});

const TimelineSchema = z.object({
  records: z.array(
    z.object({
      id: z.string(),
      parentId: text,
      type: z.string(),
      name: text,
      identifier: text,
      result: text,
      order: z.number().nullish(),
      log: z.object({ id: z.number() }).nullish(),
    }),
  ),
});

const BuildsSchema = z.object({
  value: z.array(
    z.object({
      id: z.number(),
      status: z.string(),
      result: text,
      sourceVersion: text,
      startTime: text,
      finishTime: text,
      definition: z.object({ id: z.number(), name: z.string() }),
    }),
  ),
});

const LogLinesSchema = z.object({ value: z.array(z.string()) });

type Evaluation = z.infer<typeof EvaluationsSchema>["value"][number];
type TimelineRecord = z.infer<typeof TimelineSchema>["records"][number];

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** What kind of CI a policy evaluation is, or undefined for one that is not CI. */
function ciKind(e: Evaluation): "build" | "status" | undefined {
  const { id, displayName } = e.configuration.type;
  if (id.toLowerCase() === BUILD_POLICY || displayName === "Build") return "build";
  if (id.toLowerCase() === STATUS_POLICY || displayName === "Status") return "status";
  return undefined;
}

/** The name a policy's check has on Azure DevOps' PR page. */
function nameOf(e: Evaluation, kind: "build" | "status"): string {
  const settings = e.configuration.settings ?? {};
  const context = e.context ?? {};
  if (kind === "build") return str(settings.displayName) ?? str(context.buildDefinitionName) ?? `Build ${String(settings.buildDefinitionId ?? "")}`.trim();
  const status = [str(settings.statusGenre), str(settings.statusName)].filter(Boolean).join("/");
  return str(settings.defaultDisplayName) ?? (status || (e.configuration.type.displayName ?? "Status"));
}

/** A policy evaluation as a check: its status as the bucket, its build as the link. */
function policyCheck(e: Evaluation, kind: "build" | "status", organization: string, project: string): CiCheck {
  const buildId = e.context?.buildId;
  return {
    name: nameOf(e, kind),
    bucket: azurePolicyBucket(e.status),
    state: e.status,
    ...(kind === "build" && typeof buildId === "number" ? { link: azureBuildUrl({ organization, project, buildId }) } : {}),
    ...(e.startedDate ? { startedAt: e.startedDate } : {}),
    ...(e.completedDate ? { completedAt: e.completedDate } : {}),
  };
}

/**
 * A log of Azure Pipelines, from either answer it comes as: plain text, or `{ value: [lines] }`
 * when JSON was asked for. Timestamps and colour codes go, like `gh run view --log-failed`.
 */
export function logTail(body: string, tailLines = LOG_TAIL_LINES): string {
  const parsed = parseJson(LogLinesSchema, body);
  const lines = parsed.ok ? parsed.value.value : body.replace(/^﻿/, "").split(/\r?\n/);
  const clean = lines.map((l) => stripVTControlCharacters(l.replace(/^﻿/, "")).replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").trimEnd());
  while (clean.length && clean.at(-1) === "") clean.pop();
  return clean.slice(-tailLines).join("\n");
}

/**
 * Azure Pipelines as a CI source of one organization (issue #143). For an Azure Repos pull request
 * the checks are its build validation and status policy evaluations; for any pull request whose
 * failed checks link to a build of this organization, it gives the failed tasks' log ends and
 * retries the failed stages. Never throws.
 */
export function azurePipelines(transport: AzureTransport, organization: string): CiSource {
  const get = async <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string, query?: Record<string, string>): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
    const r = await transport({ method: "GET", path, ...(query ? { query } : {}) });
    if (!r.ok) return { ok: false, error: r.error };
    const parsed = parseJson(schema, r.body);
    return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: parsed.error };
  };
  const timeline = (b: AzureBuild) => get(TimelineSchema, `${seg(b.project)}/_apis/build/builds/${b.buildId}/timeline`);
  const ours = (b: AzureBuild | undefined): b is AzureBuild => b !== undefined && b.organization === organization;

  /** The failed tasks of a build, or of one job of it, in order, each with its log. */
  function failedTasks(records: readonly TimelineRecord[], jobId: string | undefined): TimelineRecord[] {
    const failed = records
      .filter((r) => r.type === "Task" && r.result === "failed" && r.log)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const ofJob = jobId ? failed.filter((r) => r.parentId?.toLowerCase() === jobId) : [];
    return ofJob.length ? ofJob : failed;
  }

  async function logOf(check: FailedCheck, build: AzureBuild, records: readonly TimelineRecord[]): Promise<CheckLog | undefined> {
    const tasks = failedTasks(records, build.jobId);
    const tails: string[] = [];
    for (const task of tasks) {
      const r = await transport({ method: "GET", path: `${seg(build.project)}/_apis/build/builds/${build.buildId}/logs/${task.log!.id}` });
      if (!r.ok) continue;
      const tail = logTail(r.body);
      if (tail) tails.push(tasks.length > 1 ? `── ${task.name ?? "task"} ──\n${tail}` : tail);
    }
    return tails.length ? { name: check.name, tail: tails.join("\n\n") } : undefined;
  }

  return {
    async checks(pr: CiPr): Promise<PrChecks> {
      const ref = parseAzurePrUrl(pr.url);
      if (!ref) return { ok: false, error: `not an Azure DevOps pull request URL: ${pr.url}` };
      const { project, repository } = ref.repo;
      const prBody = await get(PullRequestSchema, `${seg(project)}/_apis/git/repositories/${seg(repository)}/pullrequests/${ref.number}`);
      if (!prBody.ok) return prBody;
      const artifactId = `vstfs:///CodeReview/CodeReviewId/${prBody.value.repository.project.id}/${ref.number}`;
      const evaluations = await get(EvaluationsSchema, `${seg(project)}/_apis/policy/evaluations`, { artifactId, "api-version": POLICY_API_VERSION });
      if (!evaluations.ok) return evaluations;
      const checks = evaluations.value.value.flatMap((e) => {
        const kind = ciKind(e);
        return kind && e.configuration.isEnabled !== false ? [policyCheck(e, kind, organization, project)] : [];
      });
      return { ok: true, checks };
    },

    async failedLogs(_pr, failed) {
      const timelines = new Map<string, Promise<TimelineRecord[] | undefined>>();
      const logs: CheckLog[] = [];
      for (const check of failed) {
        const build = parseAzureBuildLink(check.link);
        if (!ours(build)) continue;
        const key = azureBuildUrl(build);
        if (!timelines.has(key)) timelines.set(key, timeline(build).then((t) => (t.ok ? t.value.records : undefined)));
        const records = await timelines.get(key)!;
        const log = records && (await logOf(check, build, records));
        if (log) logs.push(log);
      }
      return logs;
    },

    /** Retries the failed stages of each build, in order; the first failure stops (D35). */
    async rerunFailed(_pr, runs): Promise<Done> {
      for (const run of runs) {
        const build = parseAzureBuildLink(run);
        if (!ours(build)) return { ok: false, error: `${run} is not a build of the Azure DevOps organization ${organization}` };
        const t = await timeline(build);
        if (!t.ok) return { ok: false, error: t.error };
        const stages = t.value.records.filter((r) => r.type === "Stage" && r.result === "failed" && r.identifier);
        if (stages.length === 0) return { ok: false, error: `build ${build.buildId} has no failed stage to retry` };
        for (const stage of stages) {
          const r = await transport({
            method: "PATCH",
            path: `${seg(build.project)}/_apis/build/builds/${build.buildId}/stages/${seg(stage.identifier!)}`,
            body: { state: "retry", forceRetryAllJobs: false },
          });
          if (!r.ok) return { ok: false, error: r.error };
        }
      }
      return { ok: true };
    },

    /**
     * The newest build of each pipeline on the branch, preferring builds of `head` when it is
     * known; a pipeline with no build (of `head`) yet has no check.
     */
    async runsOn(q: BranchRuns): Promise<PrChecks> {
      const project = q.project.toLowerCase();
      const builds = await get(BuildsSchema, `${seg(project)}/_apis/build/builds`, {
        definitions: q.definitions.join(","),
        branchName: `refs/heads/${q.branch}`,
        queryOrder: "queueTimeDescending",
        $top: "50",
      });
      if (!builds.ok) return builds;
      const newest = new Map<number, (typeof builds.value.value)[number]>();
      for (const b of builds.value.value) {
        if (q.head && b.sourceVersion?.toLowerCase() !== q.head.toLowerCase()) continue;
        if (!newest.has(b.definition.id)) newest.set(b.definition.id, b);
      }
      const checks = q.definitions.flatMap((d) => {
        const b = newest.get(d);
        if (!b) return [];
        const check: CiCheck = {
          name: b.definition.name,
          bucket: azureBuildBucket(b.status, b.result ?? undefined),
          state: b.status === "completed" ? (b.result ?? b.status) : b.status,
          link: azureBuildUrl({ organization, project, buildId: b.id }),
          ...(b.startTime ? { startedAt: b.startTime } : {}),
          ...(b.finishTime ? { completedAt: b.finishTime } : {}),
        };
        return [check];
      });
      return { ok: true, checks };
    },
  };
}
