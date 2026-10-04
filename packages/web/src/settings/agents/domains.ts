/** Textarea text, one host per line, as the list the daemon stores. Blank lines and duplicates go. */
export function parseDomains(text: string): string[] {
  const hosts = text.split(/[\s,]+/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  return [...new Set(hosts)];
}

export const formatDomains = (domains: readonly string[]): string => domains.join("\n");
