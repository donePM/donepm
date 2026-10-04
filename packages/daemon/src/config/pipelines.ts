import { parseAzureDevOpsOrigin } from "@donepm/core";
import { z } from "zod";

/**
 * `sources[origin].ci` (issue #143): this repository's pipelines run in Azure Pipelines and do not
 * report back to its host, so the CI watch reads their builds by branch instead of the pull
 * request's checks. `organization` and `project` default to an Azure Repos origin's own; any
 * other origin names them.
 */
export const CiOptInSchema = z
  .object({
    source: z.literal("azure-pipelines"),
    /** The pipeline (build definition) ids whose builds count. */
    definitions: z.array(z.number().int().positive()).min(1),
    organization: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "must be an Azure DevOps organization name")
      .optional(),
    project: z.string().trim().min(1).optional(),
  })
  .strict();

export type CiOptIn = z.infer<typeof CiOptInSchema>;

/** Where a repository's opted-in pipelines are. */
export interface PipelinesOptIn {
  organization: string;
  project: string;
  definitions: number[];
}

/** The pipelines an origin opted in to, with organization and project filled in; undefined if it did not or cannot. */
export function pipelinesOptIn(origin: string, ci: CiOptIn | undefined): PipelinesOptIn | undefined {
  if (!ci) return undefined;
  const repo = parseAzureDevOpsOrigin(origin);
  const organization = ci.organization ?? repo?.organization;
  const project = ci.project ?? repo?.project;
  return organization && project ? { organization, project, definitions: ci.definitions } : undefined;
}
