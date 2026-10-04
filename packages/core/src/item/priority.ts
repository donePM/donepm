/** 0 is the most urgent. An issue without a priority is a 2. */
export type PriorityTier = 0 | 1 | 2 | 3;

export const DEFAULT_PRIORITY_TIER: PriorityTier = 2;

const NAMES: Record<string, PriorityTier> = { critical: 0, high: 1, medium: 2, low: 3 };

/** `P0`..`P3`, or `priority` / `prio` and a name after `:` or `/` (`priority: high`, `prio/low`). */
const LABEL = /^(?:p([0-3])|prio(?:rity)?\s*[:/]\s*(critical|high|medium|low))$/i;

function tierOfLabel(label: string): PriorityTier | undefined {
  const m = LABEL.exec(label.trim());
  if (!m) return undefined;
  return m[1] !== undefined ? (Number(m[1]) as PriorityTier) : NAMES[m[2]!.toLowerCase()];
}

/** The most urgent tier any label names; `DEFAULT_PRIORITY_TIER` when none does. */
export function priorityTier(labels: readonly string[]): PriorityTier {
  let best: PriorityTier | undefined;
  for (const label of labels) {
    const tier = tierOfLabel(label);
    if (tier !== undefined && (best === undefined || tier < best)) best = tier;
  }
  return best ?? DEFAULT_PRIORITY_TIER;
}

/** Option names of a "Priority" issue field (D45). GitHub's default options are Urgent, High, Medium, Low. */
const FIELD_NAMES: Record<string, PriorityTier> = { urgent: 0, critical: 0, high: 1, medium: 2, normal: 2, low: 3 };
const FIELD_P = /^p([0-3])$/i;

/** The tier an option of GitHub's "Priority" issue field names, case-insensitive; undefined for any other option. */
export function priorityTierOfField(option: string): PriorityTier | undefined {
  const name = option.trim();
  const m = FIELD_P.exec(name);
  if (m) return Number(m[1]) as PriorityTier;
  return FIELD_NAMES[name.toLowerCase()];
}

/**
 * An issue's tier (D45): GitHub's "Priority" issue field when it is set to a known option, else
 * the labels. The field wins over a priority label.
 */
export function issuePriority(issue: { labels: readonly string[]; priorityField?: string }): PriorityTier {
  const field = issue.priorityField === undefined ? undefined : priorityTierOfField(issue.priorityField);
  return field ?? priorityTier(issue.labels);
}

/** `P1` for tier 1, as the card and the timeline name it. */
export function priorityName(tier: number): string {
  return `P${tier}`;
}
