import { fail, fakeExec, fixture, ok, type FakeCall } from "../test-support/fake-exec.js";
import { ciSourceContract } from "../test-support/contracts/ci-source.js";
import { codeHostContract } from "../test-support/contracts/code-host.js";
import { ticketSourceContract } from "../test-support/contracts/ticket-source.js";
import { gitHubCliAdapter } from "./adapter.js";

/**
 * `gh api graphql --hostname …` serves the issue fields (D45), the pull request statuses (D47) and,
 * with its variables, the review feedback (D39).
 */
function graphql(call: FakeCall) {
  if (call.args.some((a) => a.startsWith("owner="))) return ok(fixture("gh/pr-feedback.json"));
  const query = call.args.find((a) => a.startsWith("query=")) ?? "";
  return ok(fixture(query.includes("issueFieldValues") ? "gh/issue-fields.json" : "gh/pr-status.json"));
}

/** `gh api --hostname … --method POST`: a review or a reply in a thread. */
function restPost(call: FakeCall) {
  return call.args.some((a) => a.endsWith("/reviews"))
    ? ok(fixture("gh/pr-review-created.json"))
    : ok("https://github.com/acme/widgets/pull/7#discussion_r2\n");
}

/** `gh` with the user's account answering every call with the recorded fixtures. */
const answering = () =>
  gitHubCliAdapter(
    fakeExec({
      "gh search issues": ok(fixture("gh/search-issues.json")),
      "gh search prs": ok(fixture("gh/search-prs.json")),
      "gh issue list": ok(fixture("gh/issue-list.json")),
      "gh issue view": ok(fixture("gh/issue-view-open.json")),
      "gh issue edit": ok(""),
      "gh api graphql": graphql,
      "gh api --hostname": restPost,
      "gh repo clone": ok(""),
      "gh pr create": ok("https://github.com/acme/widgets/pull/42\n"),
      "gh pr view": ok(fixture("gh/pr-view-open.json")),
      "gh pr comment": ok("https://github.com/acme/widgets/pull/7#issuecomment-3\n"),
      "gh pr merge": ok(""),
      "gh pr update-branch": ok(""),
      "gh pr checks": ok(fixture("gh/pr-checks-fail.json")),
      "gh run view": ok(fixture("gh/run-view-log-failed.txt")),
      "gh run rerun": ok(""),
    }),
  );

/** `gh` after the user's token was revoked: every call fails. */
const failing = () => gitHubCliAdapter(fakeExec({ gh: fail("HTTP 401: Bad credentials (https://api.github.com/graphql)") }));

const pr = { number: 7, url: "https://github.com/acme/widgets/pull/7" };

ticketSourceContract("gh", {
  answering,
  failing,
  ticket: { externalId: "acme/widgets#161", origin: "github.com/acme/widgets" },
  origin: "github.com/acme/widgets",
  query: "label:bug",
  collected: [
    "acme/widgets#161", "acme/widgets#157", "solo/tool#61", "Acme/API#12",
    "vuejs/core#15767", "vuejs/core#15766", "vuejs/core#15767", "vuejs/core#15766",
  ],
});

codeHostContract("gh", {
  answering,
  failing,
  origin: "github.com/acme/widgets",
  create: { origin: "github.com/acme/widgets", head: "dp/7-fix", base: "main", title: "Fix", body: "Closes #7", cwd: "/wt/7" },
  created: { url: "https://github.com/acme/widgets/pull/42", number: 42 },
  pr,
  statuses: [
    { repository: "acme/widgets", number: 88, state: "OPEN" },
    { repository: "vuejs/core", number: 15766, state: "OPEN" },
    { repository: "acme/widgets", number: 129, state: "MERGED" },
  ],
  inReplyTo: 41,
  review: { number: 7, url: pr.url, commitId: "c0ffee0000000000000000000000000000000000", verdict: "COMMENT", body: "Looks good.", comments: [] },
});

ciSourceContract("gh", {
  answering,
  failing,
  pr,
  failed: [
    { name: "test (ubuntu-latest, node 24)", link: "https://github.com/donePM/donepm/actions/runs/37149187747/job/111279498956" },
    { name: "test (ubuntu-latest, node 22)", link: "https://github.com/donePM/donepm/actions/runs/37149187747/job/111279499110" },
  ],
});
