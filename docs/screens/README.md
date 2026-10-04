# MVP screens

Static mockups of the four MVP screens. `*.png` are rendered at 1360px width, 2x. `src/*.html` are
the sources: plain HTML with inline styles, no build step, open them in a browser. They are the
reference for layout, spacing and palette when building `packages/web`, not code to copy.

| screen | shows | built in |
|---|---|---|
| `board.png` | four columns, Ready card with playbook and Start, running card, PR-draft and permission cards, Done cards, card without local clone | #3, #5, #7 |
| `draft.png` | item detail: editable PR draft, approve/reject, diff, event timeline, worktree block | #7 |
| `agents.png` | multiplexer: agent list with cost, live transcript with grouped reads, todo checklist, edit preview, failed command with its output, running tool, composer | #5, #69 |
| `settings.png` | source detection with hints, repo table, orphaned worktree, general settings, playbooks, daemon | #3 |

Palette and fonts: see `docs/spec.md` §12.
