import j2m from "jira2md";
import { markdownToAdf } from "marklassian";

/**
 * A comment's Markdown as the site takes it (issue #139): Atlassian Document Format for Cloud's v3
 * API, wiki markup for Data Center's v2 API.
 */
export function jiraBody(markdown: string, apiVersion: "2" | "3"): unknown {
  return apiVersion === "3" ? markdownToAdf(markdown) : j2m.to_jira(markdown);
}
