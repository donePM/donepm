/** Which icon marks a link to the ticket's source. `web` (a globe) is the fallback. */
export type SourceIconName = "github" | "web";

export interface SourceLink {
  icon: SourceIconName;
  /** Where the link goes, for its tooltip: "GitHub", or the URL's host. */
  site: string;
}

interface SourceRule {
  icon: SourceIconName;
  site: string;
  /** Item sources this rule covers, used when the URL cannot be parsed. */
  sources: readonly string[];
  /** URL hosts this rule covers; their subdomains match too. */
  hosts: readonly string[];
}

/** One entry per ticket source. Jira (#139) and Azure DevOps (#142) add theirs here. */
const RULES: readonly SourceRule[] = [{ icon: "github", site: "GitHub", sources: ["github-issue", "github-pr"], hosts: ["github.com"] }];

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

const coversHost = (rule: SourceRule, host: string) => rule.hosts.some((h) => host === h || host.endsWith(`.${h}`));

/**
 * The icon and site name for a link that leaves donePM for the item's source (issue #151).
 * The URL's host decides, so the icon always shows where the link really goes; the item's
 * source is the fallback for a URL without a host. Anything unknown gets the globe.
 */
export function sourceLink(item: { source: string; externalUrl: string }): SourceLink {
  const host = hostOf(item.externalUrl);
  const rule = host ? RULES.find((r) => coversHost(r, host)) : RULES.find((r) => r.sources.includes(item.source));
  if (rule) return { icon: rule.icon, site: rule.site };
  return { icon: "web", site: host ?? "the source" };
}
