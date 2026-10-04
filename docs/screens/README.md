# UI mockups (v2, light and dark)

Static mockups of the five main screens in both themes. `*.png` are rendered at 1360px width.
`src/*.html` are the sources: plain HTML, one shared stylesheet `src/ui.css` that holds every
token and component; the `.app` root carries `light` or `dark`. Open them in a browser; they link
to each other. They are the reference for layout, spacing, palette and components when working on
`packages/web`, not code to copy verbatim. `ui.css` is meant to become `packages/web/src/theme.css`.

| screen | shows | issues |
|---|---|---|
| `board-*.png` | swimlanes per repo, four columns, card variants: ready, running, waiting for CI, PR draft, conflict, permission, merged; collapsed lane with Dependabot PRs | #126, #128 |
| `item-*.png` | item detail: tabs, editable PR draft with Write/Preview, approve/reject, diff, timeline with tokens and cost, worktree block | #126, #128 |
| `agents-*.png` | multiplexer: running / waiting for CI / waiting for you / finished, transcript with tools, subagent, live Bash | #126, #128 |
| `settings-repos-*.png` | settings navigation, repository table with inline editor (query, test, default playbook, assign on start, ignore, Dependabot), orphaned worktrees | #126, #127 |
| `settings-agents-*.png` | agents and access: slots, poll interval, worktree automation, notifications, always-allow rules, deny list, web access, tools | #126, #127 |

## Palette

Light: ground `#fafafa`, card `#ffffff`, muted `#f4f4f5`, ink `#09090b` / `#3f3f46` / `#6b6b76`,
border `#e4e4e7` / `#d4d4d8`, primary `#4f46e5` (hover `#4338ca`, tint `#eef2ff`), attention
`#b45309` (tint `#fffbeb`, border `#fcd34d`), ok `#15803d` (tint `#dcfce7`), danger `#dc2626`.

Dark: ground `#09090b`, card `#18181b`, muted `#27272a`, ink `#fafafa` / `#d4d4d8` / `#a1a1aa`,
border `#27272a` / `#3f3f46`, primary `#6366f1` (hover `#818cf8`), attention `#fbbf24`, ok
`#4ade80`, danger `#f87171`; tints are the same hues at 12–18% alpha.

Fonts: IBM Plex Sans, JetBrains Mono. Icons: inline stroke SVG in the Lucide style, 16px.
