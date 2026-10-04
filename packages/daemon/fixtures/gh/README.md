# gh fixtures

Recorded with `gh` 2.102.0 on 2026-10-03.

- `search-issues.json`: `gh search issues --assignee=@me --state=open --json number,title,body,createdAt,labels,repository,url`.
  Shape, key order and label objects are as recorded. Repository names, titles and bodies are
  replaced because the real issues are private.
- `issue-list.json`: `gh issue list --assignee @me --state open --json number,title,body,createdAt,labels,url` (fallback path), redacted the same way.
- `createdAt` was added to both later (issue #64) with made-up timestamps in the recorded format.
- `issue-view-*.json`: `gh issue view <n> --repo <r> --json state`.
- `auth-status-*`: `gh auth status` output; account name replaced.
- `search-unknown-command.stderr`: what an old `gh` without `search issues` prints.
