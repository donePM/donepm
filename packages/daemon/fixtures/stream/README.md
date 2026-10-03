# stream-json fixtures

Recorded from `claude 2.1.288` with `model: haiku`, invoked with the argv from `src/agent/argv.ts`
(`--permission-prompt-tool stdio`, deny rules via `--settings`), one prompt each:

| file | what happens |
|---|---|
| `basic.jsonl` | thinking, two tool calls with results, text, `result` |
| `ask-allow.jsonl` | `control_request` for `curl`, answered with allow |
| `ask-deny.jsonl` | the same ask, answered with deny |
| `deny-gh.jsonl` | `gh` is refused by the `Bash(gh *)` deny rule without asking |

Redacted before committing: absolute paths (`/tmp/donepm-fixture`, `/Users/someone`), the
user's MCP servers, slash commands, agents, skills and plugins in `init`, and hook output
(`"[trimmed]"`). Nothing else was changed, so line order and event shapes are as recorded.
