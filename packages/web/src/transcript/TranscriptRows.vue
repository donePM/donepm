<script setup lang="ts">
import { computed, reactive } from "vue";
import AskInput from "../asks/AskInput.vue";
import AskPanel from "../asks/AskPanel.vue";
import AnsiText from "../ansi/AnsiText.vue";
import MarkdownView from "../markdown/MarkdownView.vue";
import type { RepoRef } from "../markdown/render";
import { rendersMarkdown } from "./markdown";
import { agentNote, askOutcomeText, groupNote, hasPendingAsk, lastTool, type Row } from "./rows";
import ToolStep from "./ToolStep.vue";
import TranscriptRows from "./TranscriptRows.vue";

const props = defineProps<{
  rows: Row[];
  live: string;
  now: number;
  running: boolean;
  /** For `#123` and relative links in the agent's Markdown. */
  repo?: RepoRef;
  /** The item's worktree, for asks that run somewhere else. */
  worktree?: string;
}>();

/** Rows the user opened (tools, thinking, the task). A subagent waiting on the user stays open. */
const open = reactive(new Set<string>());
const toggle = (id: string) => (open.has(id) ? open.delete(id) : open.add(id));
const isOpen = (row: Row) => open.has(row.id) || hasPendingAsk(row);

/** Only the latest tool call without a result counts as running, and only while the agent runs. */
const runningTool = computed(() => {
  if (!props.running) return undefined;
  const last = lastTool(props.rows);
  return last && !last.result ? last.id : undefined;
});
const groupRunning = (row: Extract<Row, { type: "group" }>) => row.children.some((c) => c.id === runningTool.value);

const TASK_PREVIEW = 220;
const preview = (text: string) => (text.length > TASK_PREVIEW ? `${text.slice(0, TASK_PREVIEW).trimEnd()} …` : text);
</script>

<template>
  <div class="rows">
    <template v-for="row in rows" :key="row.id">
      <div v-if="row.type === 'task'" class="row">
        <span class="who">Task</span>
        <div class="bubble">
          <MarkdownView v-if="open.has(row.id) && rendersMarkdown(row)" :source="row.text" :repo="repo" compact />
          <span v-else class="pre">{{ open.has(row.id) ? row.text : preview(row.text) }}</span>
          <button v-if="row.text.length > TASK_PREVIEW" class="link" type="button" @click="toggle(row.id)">
            {{ open.has(row.id) ? "show less" : "show all" }}
          </button>
        </div>
      </div>

      <div v-else-if="row.type === 'user'" class="row">
        <span class="who">You</span>
        <div class="bubble pre">{{ row.text }}</div>
      </div>

      <div v-else-if="row.type === 'setup'" class="row">
        <span class="who">Setup</span>
        <div class="call" :class="{ failed: !row.ok }">
          <button class="tool-head" type="button" :disabled="!row.output" @click="toggle(row.id)">
            <span class="dim">{{ row.output ? (open.has(row.id) ? "▾" : "▸") : "" }} {{ row.ok ? "ok" : "failed" }}</span>
            <span class="summary">{{ row.label }}</span>
          </button>
          <pre v-if="open.has(row.id)" class="body"><AnsiText :text="row.output ?? ''" /></pre>
        </div>
      </div>

      <div v-else-if="row.type === 'thinking'" class="row">
        <span class="who"></span>
        <div class="thinking">
          <button class="link dim" type="button" @click="toggle(row.id)">{{ open.has(row.id) ? "▾" : "▸" }} Thinking</button>
          <p v-if="open.has(row.id)" class="pre dim">{{ row.text || "(not shown by the model)" }}</p>
        </div>
      </div>

      <div v-else-if="row.type === 'text'" class="row">
        <span class="who agent">Agent</span>
        <MarkdownView v-if="rendersMarkdown(row)" class="text" :source="row.text" :repo="repo" compact />
        <div v-else class="text pre">{{ row.text }}</div>
      </div>

      <div v-else-if="row.type === 'tool'" class="row step-row">
        <span class="who"></span>
        <ToolStep :row="row" :open="open.has(row.id)" :running="runningTool === row.id" :now="now" @toggle="toggle(row.id)" />
      </div>

      <div v-else-if="row.type === 'group'" class="row step-row">
        <span class="who"></span>
        <div class="group" :class="{ running: groupRunning(row) }">
          <button class="tool-head" type="button" :aria-expanded="open.has(row.id)" @click="toggle(row.id)">
            <span v-if="groupRunning(row)" class="dot primary" aria-hidden="true"></span>
            <span v-else class="dim">{{ open.has(row.id) ? "▾" : "▸" }}</span>
            <span class="dim">{{ row.label }}</span>
            <span class="summary">{{ row.summary }}</span>
            <span class="note dim" :class="{ bad: groupNote(row) }">{{ groupRunning(row) ? "running" : groupNote(row) }}</span>
          </button>
          <div v-if="open.has(row.id)" class="group-steps">
            <ToolStep
              v-for="c in row.children" :key="c.id" :row="c" :open="open.has(c.id)" :running="runningTool === c.id" :now="now" @toggle="toggle(c.id)"
            />
          </div>
        </div>
      </div>

      <div v-else-if="row.type === 'agent'" class="row">
        <span class="who agent">Subagent</span>
        <div class="call sub" :class="{ running: running && row.status === 'running', failed: row.status === 'failed' }">
          <button class="tool-head" type="button" @click="toggle(row.id)">
            <span v-if="running && row.status === 'running'" class="dot primary" aria-hidden="true"></span>
            <span class="dim">{{ running && row.status === "running" ? "" : isOpen(row) ? "▾" : "▸" }} {{ row.agentType ?? "Agent" }}</span>
            <span class="summary">{{ row.description }}</span>
            <span class="note dim">{{ agentNote(row, running, now) }}</span>
          </button>
          <div v-if="isOpen(row)" class="children">
            <p class="meta dim">
              {{ [row.model, row.background ? "in the background" : "", `${row.children.length} steps`].filter(Boolean).join(" · ") }}
            </p>
            <TranscriptRows
              :rows="row.children" live="" :now="now" :running="running && row.status === 'running'" :repo="repo" :worktree="worktree"
            />
          </div>
          <div v-if="isOpen(row) && row.result" class="body result report">
            <MarkdownView v-if="row.result.text" :source="row.result.text" :repo="repo" compact />
            <span v-else class="dim">(no report)</span>
          </div>
        </div>
      </div>

      <div v-else-if="row.type === 'ask'" class="row">
        <span class="who ask">Asked</span>
        <div v-if="row.ask" class="ask-open">
          <AskPanel :ask-id="row.ask.id" :tool-name="row.name" :input="row.input" :subject="row.ask.subject" :rules="row.ask.rules" :reason="row.reason" :worktree="worktree" :repo="repo" />
        </div>
        <div v-else class="call">
          <button class="tool-head" type="button" @click="toggle(row.id)">
            <span class="dim">{{ open.has(row.id) ? "▾" : "▸" }} {{ row.name }}</span>
            <span class="summary">{{ row.summary }}</span>
            <span class="note outcome" :class="row.outcome">{{ askOutcomeText(row) }}</span>
          </button>
          <AskInput v-if="open.has(row.id)" class="ask-input" :tool-name="row.name" :input="row.input" :worktree="worktree" />
        </div>
      </div>

      <div v-else-if="row.type === 'result'" class="row">
        <span class="who"></span>
        <div class="turn" :class="{ failed: !row.ok }">{{ row.label }}</div>
      </div>
    </template>

    <div v-if="live" class="row">
      <span class="who agent">Agent</span>
      <MarkdownView class="text live" :source="live" :repo="repo" compact />
    </div>
  </div>
</template>

<style scoped>
.rows { display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; gap: 12px; }
.who {
  flex: none;
  width: 56px;
  padding-top: 3px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-3);
}
.who.agent { color: var(--primary); }
.who.ask { color: var(--attn); }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.dim { color: var(--fg-3); }
.bubble {
  flex: 1;
  min-width: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  line-height: 1.5;
  color: var(--fg-2);
}
.text { flex: 1; min-width: 0; line-height: 1.55; }
.text.live { color: var(--fg-2); }
/* The cursor sits after the last block the stream has written so far. */
.text.live :deep(> :last-child)::after {
  content: "";
  display: inline-block;
  width: 8px;
  height: 14px;
  margin-left: 2px;
  background: var(--primary);
  vertical-align: text-bottom;
}
.link { border: 0; background: none; padding: 0; margin-left: 6px; font: inherit; font-size: 13px; color: var(--primary); cursor: pointer; }
.thinking { flex: 1; min-width: 0; }
.thinking .link { margin-left: 0; color: var(--fg-3); }
.thinking p { margin: 6px 0 0; font-size: 13px; line-height: 1.5; }
.call {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
  overflow: hidden;
  font-family: var(--mono);
  font-size: 12px;
}
.call.running { border-color: var(--primary-ring); }
/* Steps follow each other closely; text and turns keep their distance. */
.step-row + .step-row { margin-top: -10px; }
.group {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
  overflow: hidden;
  font-family: var(--mono);
  font-size: 12px;
}
.group.running { border-color: var(--primary-ring); }
.group > .tool-head:hover { background: var(--muted); }
.group-steps { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 4px 14px; border-top: 1px solid var(--border); }
.note.bad { color: var(--danger); }
.call.failed { border-color: var(--danger); }
.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: none;
  font: inherit;
  color: var(--fg-2);
  text-align: left;
  cursor: pointer;
}
.tool-head:disabled { cursor: default; }
.summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { margin-left: auto; flex: none; padding-left: 8px; }
.body {
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  max-height: 360px;
  overflow: auto;
  line-height: 1.6;
  white-space: pre;
}
.body.result { color: var(--fg-2); }
.call.sub { font-family: inherit; font-size: 13px; border-style: dashed; }
.call.sub > .tool-head { font-family: var(--mono); font-size: 12px; }
.children { padding: 10px 12px 12px; border-top: 1px solid var(--border); }
.children .meta { margin: 0 0 10px; font-size: 12px; }
.report { white-space: normal; font-family: inherit; font-size: 13px; }
.ask-open {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--attn);
  border-radius: 8px;
  background: var(--card);
  font-size: 13px;
}
.ask-input { padding: 8px 12px; border-top: 1px solid var(--border); }
.outcome.denied { color: var(--danger); }
.outcome.allowed, .outcome.allowed_run, .outcome.expired { color: var(--fg-3); }
.turn { font-size: 12px; color: var(--fg-3); }
.turn.failed { color: var(--danger); }
</style>
