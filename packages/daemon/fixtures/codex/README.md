# codex fixtures

`codex app-server --listen stdio://` output, one JSON-RPC frame per line, as donePM's Codex adapter
reads it (issue #137). Only what Codex wrote: donePM's own requests and answers are not in them.

Recorded by Bloom (`spatie/bloom`, MIT, © Spatie bvba) against `codex` 0.147.0 and copied from its
`Tests/fixtures/` unchanged; Bloom's `docs/CODEX.md` describes how. They assume donePM's request
ids: 1 `initialize`, 2 `thread/start` or `thread/resume`, 3 `turn/start`, 4 `turn/interrupt`.

- `turn.ndjson` (Bloom `codex-turn.ndjson`): a new thread, one turn, one word of reply.
- `resume-file-approval.ndjson` (Bloom `codex-approval.ndjson`): the same thread resumed in a new
  process (its usage so far arrives first, for the earlier turn), a file change asked for and
  declined, then the reply.
- `resume-interrupt.ndjson` (Bloom `codex-interrupt.ndjson`): resumed again, a turn interrupted by
  `turn/interrupt` (the `{"id":4,"result":{}}`), ending as `interrupted`.
- `edit-patch.ndjson` (Bloom `codex-edit-patch.ndjson`): a file change that updates a file, its diff
  a bare hunk.

Written by hand, not recorded (no turn was run for donePM):

- `command-approval.ndjson`: a new thread whose turn asks to run two commands, `rm -rf build`
  (approved) and `gh pr create` (declined by donePM itself). Shapes follow the app-server v2 schema
  of `codex` 0.133.0 (`codex app-server generate-ts`).
