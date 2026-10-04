# gh fixtures

Recorded with `gh` 2.102.0 on 2026-10-03.

- `search-issues.json`: `gh search issues --assignee=@me --state=open --json number,title,body,createdAt,labels,repository,url`.
  Shape, key order and label objects are as recorded. Repository names, titles and bodies are
  replaced because the real issues are private.
- `issue-list.json`: `gh issue list --assignee @me --state open --json number,title,body,createdAt,labels,url` (fallback path), redacted the same way.
- `createdAt` was added to both later (issue #64) with made-up timestamps in the recorded format.
- `issue-view-*.json`: `gh issue view <n> --repo <r> --json state`. `issue-view-merged-pr.json` is
  what it answers for a merged pull request (`MERGED`, D40).
- `search-prs.json`: `gh search prs --repo vuejs/core --state=open --json number,title,body,createdAt,labels,repository,url,author --limit 2`
  on 2026-10-04, two public PRs. donePM asks with `--review-requested=@me` and `--assignee=@me`
  instead, which answer in the same shape; the recording account had no open review requests.
  `search-prs-empty.json` is an empty answer.
- `search-prs-dependabot.json`: the same fields for `--repo donePM/donepm --author app/dependabot
  --limit 2` on 2026-10-04: Dependabot's PRs #88 and #87, author `dependabot[bot]` (D47).
- `pr-view-*.json`: `gh pr view <n> --repo <r> --json state,mergedAt,mergeable,baseRefName`.
  `pr-view-merged.json` is PR #81 of this repository (2026-10-04); a merged PR reports `UNKNOWN`.
  `open`, `conflicting` and `unknown` are written by hand in the same shape, since no open PR
  conflicted when recording. `pr-view-review.json` is vuejs/core#15766 (2026-10-04), an open PR
  into `minor`.
- `auth-status-*`: `gh auth status` output; account name replaced.
- `search-unknown-command.stderr`: what an old `gh` without `search issues` prints.
- `pr-checks-pass.json`: `gh pr checks 80 --json name,state,bucket,link,workflow,startedAt,completedAt`
  on this repository (2026-10-04).
- `pr-checks-fail.json`: the jobs of the failed run 37149187747 in the same shape (built with
  `gh run view --json jobs`, since no open PR was red when recording).
- `pr-checks-pending.json`: `pr-checks-pass.json` with checks set to in progress and queued by
  hand; gh writes Go's zero time for a timestamp that is not set yet.
- `pr-checks-none.stderr`: what gh prints (exit 1) when a PR has no checks; written by hand from
  gh's source.
- `run-view-log-failed.txt`: `gh run view 37149187747 --log-failed`, the last 25 lines per job.
- `pr-feedback.json`: `gh api graphql -F owner=vuejs -F name=core -F number=15751 -f query=<FEEDBACK_QUERY>`
  (`src/gh/pr-feedback.ts`) on 2026-10-04, a public PR with a review that requests changes, its
  inline comment, and bot comments.
- `pr-review-created.json`: GitHub's answer to `POST /repos/{owner}/{repo}/pulls/{n}/reviews`,
  written by hand from GitHub's REST docs (posting a review on someone else's PR to record one is
  not acceptable); donePM only reads `id` and `html_url`.
- `pr-feedback-bots.json`: the same with the review nodes emptied by hand, so only the bot comments
  remain.
- `search-issues.json` got `id` later (issue #95): `gh search issues --json id,…` answers GitHub's
  global node id (`I_kwDO…`); the recorded ids are replaced by `I_kwDOredacted<number>`.
- `issue-fields.json`: `gh api graphql -f query=<issueFieldsQuery(ids)>` (`src/gh/issue-fields.ts`)
  for the same four issues on 2026-10-04 with gh 2.102.0, ids redacted the same way. The first two
  belong to an organization with the issue field "Priority" (options Urgent, High, Medium, Low)
  set to Medium and Low; the other two have none (a user-owned repo, and an organization without
  the field).
- `issue-fields-not-found.json`: the answer when one id does not resolve (gh exits 1, the other
  nodes are still there); recorded with a made-up id.
- `issue-fields-unsupported.json`: the answer of a GitHub that has no `issueFieldValues`; recorded
  with a misspelt field name and the name put back, since github.com has the field.
- `pr-status.json`: `gh api graphql -f query=<prStatusQuery(refs)>` (`src/gh/pr-status.ts`) for
  donePM/donepm#88 (Dependabot, open), vuejs/core#15766 (open, base `minor`) and donePM/donepm#129
  (merged) on 2026-10-04 with gh 2.102.0.
- `pr-status-not-found.json`: the same for donePM/donepm#87 and a made-up #99999 (gh exits 1, the
  found pull request is still there).
