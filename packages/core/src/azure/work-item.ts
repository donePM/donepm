import { DEFAULT_PRIORITY_TIER, type PriorityTier } from "../item/priority.js";
import type { WorkItem } from "../item/types.js";
import { isNumberKey, parseTicketId } from "../jira/ticket.js";
import { azureOrganizationOf, azureOrganizationUrl } from "./devops.js";

/**
 * A state's category in Azure Boards, the same in every process (Agile, Scrum, CMMI, Basic and
 * inherited ones): `Proposed`, `InProgress`, `Resolved`, `Completed` or `Removed`.
 */
export type AzureStateCategory = string;

/** Categories whose work items are finished: they close an item upstream (D32) and are not collected. */
const FINISHED: ReadonlySet<string> = new Set(["completed", "removed"]);

/** Whether a work item in a state of this category is finished, whatever the process calls the state. */
export function isFinishedCategory(category: AzureStateCategory | undefined): boolean {
  return category !== undefined && FINISHED.has(category.toLowerCase());
}

/**
 * The tier of `Microsoft.VSTS.Common.Priority` (D45): 1 is the most urgent and 4 the least, so 1–4
 * become 0–3. None, or anything else, is a 2.
 */
export function azurePriorityTier(priority: unknown): PriorityTier {
  return typeof priority === "number" && Number.isInteger(priority) && priority >= 1 && priority <= 4
    ? ((priority - 1) as PriorityTier)
    : DEFAULT_PRIORITY_TIER;
}

/** `System.Tags` (`"auth; regression"`) and the work item type, as labels: the type lets playbook `match` and the bug colour work. */
export function workItemLabels(tags: string | null | undefined, type: string | null | undefined): string[] {
  const labels = (tags ?? "").split(";").map((t) => t.trim()).filter(Boolean);
  if (type?.trim()) labels.push(type.trim());
  return [...new Set(labels)];
}

/** A work item's text fields, already Markdown. */
export interface WorkItemText {
  description?: string;
  acceptanceCriteria?: string;
  reproSteps?: string;
}

/**
 * A work item's body (issue #142): the description, then the acceptance criteria and a bug's repro
 * steps under their own headings, so the agent reads all three. Empty parts are left out.
 */
export function workItemBody(text: WorkItemText): string {
  const parts: string[] = [];
  const description = text.description?.trim();
  if (description) parts.push(description);
  const acceptance = text.acceptanceCriteria?.trim();
  if (acceptance) parts.push(`## Acceptance criteria\n\n${acceptance}`);
  const repro = text.reproSteps?.trim();
  if (repro) parts.push(`## Repro steps\n\n${repro}`);
  return parts.join("\n\n");
}

/** `https://dev.azure.com/<org>/<project>/_workitems/edit/<id>`: where Azure Boards shows a work item. */
export function azureWorkItemUrl(organization: string, project: string, id: number): string {
  return `${azureOrganizationUrl(organization)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}

/**
 * A PR description that links a work item from a GitHub repository connected to Azure Boards:
 * `AB#1234` on a line of its own, unless the description names it already. Azure Repos links
 * through the PR's work item refs instead (issue #142).
 */
export function withBoardsLink(body: string, id: number): string {
  const mention = `AB#${id}`;
  if (new RegExp(`\\b${mention}\\b`, "i").test(body)) return body;
  const trimmed = body.trimEnd();
  return trimmed ? `${trimmed}\n\n${mention}` : mention;
}

/**
 * The Azure Boards work item an item was collected from (issue #142): its organization, read off
 * its URL, and its number. Undefined for any other item.
 */
export function boardsWorkItemOf(item: Pick<WorkItem, "source" | "externalId" | "externalUrl">): { organization: string; id: number } | undefined {
  if (item.source !== "ado-work-item") return undefined;
  const key = parseTicketId(item.externalId)?.key;
  const organization = azureOrganizationOf(item.externalUrl);
  return key && isNumberKey(key) && organization ? { organization, id: Number(key) } : undefined;
}
