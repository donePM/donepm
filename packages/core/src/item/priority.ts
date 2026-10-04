/** 0 is the most urgent. An issue without a priority label is a 2. */
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
