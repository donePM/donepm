import { describe, expect, it } from "vitest";
import { sourceLink } from "./source-link";

describe("sourceLink (#151)", () => {
  it("marks GitHub issues and pull requests with the GitHub icon", () => {
    expect(sourceLink({ source: "github-issue", externalUrl: "https://github.com/o/r/issues/4" })).toEqual({ icon: "github", site: "GitHub" });
    expect(sourceLink({ source: "github-pr", externalUrl: "https://github.com/o/r/pull/9" })).toEqual({ icon: "github", site: "GitHub" });
  });

  it("goes by the URL's host, subdomains and case included", () => {
    expect(sourceLink({ source: "github-issue", externalUrl: "https://GitHub.com/o/r/issues/4" }).icon).toBe("github");
    expect(sourceLink({ source: "github-issue", externalUrl: "https://gist.github.com/o/1" }).icon).toBe("github");
    expect(sourceLink({ source: "jira", externalUrl: "https://notgithub.com/o/r" }).icon).toBe("web");
  });

  it("marks GitHub Enterprise links as GitHub, naming a host of its own (issue #140)", () => {
    expect(sourceLink({ source: "github-issue", externalUrl: "https://acme.ghe.com/team/app/issues/7" })).toEqual({ icon: "github", site: "GitHub" });
    expect(sourceLink({ source: "github-pr", externalUrl: "https://github.acme.com/team/app/pull/42" })).toEqual({
      icon: "github", site: "GitHub (github.acme.com)",
    });
    expect(sourceLink({ source: "jira", externalUrl: "https://github.acme.com/team/app/pull/42" }).icon).toBe("web");
  });

  it("shows the globe and the host for a source it does not know", () => {
    expect(sourceLink({ source: "linear", externalUrl: "https://linear.app/acme/issue/OPS-1" })).toEqual({ icon: "web", site: "linear.app" });
  });

  it("marks Jira tickets, on Cloud and on a Data Center host of its own (issue #139)", () => {
    expect(sourceLink({ source: "jira-issue", externalUrl: "https://acme.atlassian.net/browse/APP-123" })).toEqual({ icon: "ticket", site: "Jira" });
    expect(sourceLink({ source: "jira-issue", externalUrl: "https://jira.acme.com/browse/OPS-7" })).toEqual({ icon: "ticket", site: "Jira (jira.acme.com)" });
    expect(sourceLink({ source: "jira-issue", externalUrl: "" })).toEqual({ icon: "ticket", site: "Jira" });
  });

  it("falls back to the item's source when the URL has no host", () => {
    expect(sourceLink({ source: "github-pr", externalUrl: "" })).toEqual({ icon: "github", site: "GitHub" });
    expect(sourceLink({ source: "jira", externalUrl: "not a url" })).toEqual({ icon: "web", site: "the source" });
  });
});
