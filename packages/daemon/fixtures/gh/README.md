# gh fixtures

Recorded with `gh` 2.102.0 on 2026-10-03.

- `search-issues.json`: `gh search issues --assignee=@me --state=open --json number,title,body,createdAt,labels,repository,url`.
  Shape, key order and label objects are as recorded. Repository names, titles and bodies are
  replaced because the real issues are private.
- `issue-list.json`: `gh issue list --assignee @me --state open --json number,title,body,createdAt,labels,url` (fallback path), redacted the same way.
- `createdAt` was added to both later (issue #64) with made-up timestamps in the recorded format.
- `issue-view-*.json`: `gh issue view <n> --repo <r> --json state`.
- `pr-view-*.json`: `gh pr view <n> --repo <r> --json state,mergedAt`. Written by hand in gh's
  shape (sorted keys, `mergedAt` null while open); re-record with a real PR when convenient.
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
