export const PLACEHOLDERS = ["externalId", "title", "body", "labels", "branch", "repoPath"] as const;
export type PlaceholderName = (typeof PLACEHOLDERS)[number];
export type PlaceholderValues = Record<PlaceholderName, string>;

export class PlaceholderError extends Error {
  constructor(readonly placeholder: string) {
    super(`Unknown placeholder "{{ ${placeholder} }}"`);
    this.name = "PlaceholderError";
  }
}

/** Single pass, so values containing `{{ ... }}` (e.g. an issue body) are never expanded again. */
export function renderPlaybookBody(template: string, values: PlaceholderValues): string {
  return template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_m, name: string) => {
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) throw new PlaceholderError(name);
    return values[name as PlaceholderName];
  });
}

/** Convenience for the item fields; `labels` are joined with ", ". */
export function placeholderValues(input: {
  externalId: string;
  title: string;
  body: string;
  labels: string[];
  branch: string;
  repoPath: string;
}): PlaceholderValues {
  return { ...input, labels: input.labels.join(", ") };
}
