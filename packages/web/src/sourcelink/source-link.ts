/** Which icon marks a link to the ticket's source. `web` (a globe) is the fallback. */
export type SourceIconName = "github" | "ticket" | "web";

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
  /**
   * The source's own items link to it on any host: a GitHub Enterprise Server has a host of the
   * company's choosing (issue #140).
   */
  anyHost?: true;
}

/** One entry per ticket source. Jira (#139) and Azure DevOps (#142) add theirs here. */
const RULES: readonly SourceRule[] = [
  { icon: "github", site: "GitHub", sources: ["github-issue", "github-pr"], hosts: ["github.com", "ghe.com"], anyHost: true },
  // Jira Data Center runs on a host of the company's choosing, like GitHub Enterprise Server.
  { icon: "ticket", site: "Jira", sources: ["jira-issue"], hosts: ["atlassian.net"], anyHost: true },
  { icon: "ticket", site: "Azure Boards", sources: ["ado-work-item"], hosts: ["dev.azure.com", "visualstudio.com"] },
];

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
 * source is the fallback for a URL without a host, and for a GitHub item on a GitHub Enterprise
 * host, named with that host (issue #140). Anything unknown gets the globe.
 */
export function sourceLink(item: { source: string; externalUrl: string }): SourceLink {
  const host = hostOf(item.externalUrl);
  const ofSource = RULES.find((r) => r.sources.includes(item.source));
  if (!host) return ofSource ? { icon: ofSource.icon, site: ofSource.site } : { icon: "web", site: "the source" };
  const rule = RULES.find((r) => coversHost(r, host));
  if (rule) return { icon: rule.icon, site: rule.site };
  if (ofSource?.anyHost) return { icon: ofSource.icon, site: `${ofSource.site} (${host})` };
  return { icon: "web", site: host };
}
