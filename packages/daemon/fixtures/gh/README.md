# gh fixtures

Recorded with `gh` 2.102.0 on 2026-10-03.

- `search-issues.json`: `gh search issues --assignee=@me --state=open --json number,title,body,createdAt,labels,repository,url`.
  Shape, key order and label objects are as recorded. Repository names, titles and bodies are
  replaced because the real issues are private.
- `issue-list.json`: `gh issue list --assignee @me --state open --json number,title,body,createdAt,labels,url` (fallback path), redacted the same way.
- `createdAt` was added to both later (issue #64) with made-up timestamps in the recorded format.
- `issue-view-*.json`: `gh issue view <n> --repo <r> --json state`. `issue-view-merged-pr.json` is
  what it answers for a merged pull request (`MERGED`, D40).
- `search-prs.json`: `gh search prs --repo vuejs/core --state=open --json number,title,body,createdAt,labels,repository,url --limit 2`
  on 2026-10-04, two public PRs. donePM asks with `--review-requested=@me` instead, which answers
  in the same shape; the recording account had no open review requests. `search-prs-empty.json`
  is an empty answer.
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
