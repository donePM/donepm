<script setup lang="ts">
import { computed, reactive } from "vue";
import { clock } from "../time/duration";
import { resultNote, type Row } from "./rows";

const props = defineProps<{ rows: Row[]; live: string; now: number; running: boolean }>();

/** Rows the user opened (tools, thinking, the task). */
const open = reactive(new Set<string>());
const toggle = (id: string) => (open.has(id) ? open.delete(id) : open.add(id));

/** Only the latest tool call without a result counts as running, and only while the agent runs. */
const runningTool = computed(() => {
  if (!props.running) return undefined;
  const last = [...props.rows].reverse().find((r) => r.type === "tool");
  return last?.type === "tool" && !last.result ? last.id : undefined;
});

const TASK_PREVIEW = 220;
const preview = (text: string) => (text.length > TASK_PREVIEW ? `${text.slice(0, TASK_PREVIEW).trimEnd()} …` : text);
const formatInput = (input: unknown) => JSON.stringify(input, null, 2);
</script>

<template>
  <div class="rows">
    <template v-for="row in rows" :key="row.id">
      <div v-if="row.type === 'task'" class="row">
        <span class="who">Task</span>
        <div class="bubble">
          <span class="pre">{{ open.has(row.id) ? row.text : preview(row.text) }}</span>
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
        <div class="tool" :class="{ failed: !row.ok }">
          <button class="tool-head" type="button" :disabled="!row.output" @click="toggle(row.id)">
            <span class="dim">{{ row.output ? (open.has(row.id) ? "▾" : "▸") : "" }} {{ row.ok ? "ok" : "failed" }}</span>
            <span class="summary">{{ row.label }}</span>
          </button>
          <pre v-if="open.has(row.id)" class="body">{{ row.output }}</pre>
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
        <div class="text pre">{{ row.text }}</div>
      </div>

      <div v-else-if="row.type === 'tool'" class="row">
        <span class="who"></span>
        <div class="tool" :class="{ running: runningTool === row.id, failed: row.result?.isError }">
          <button class="tool-head" type="button" @click="toggle(row.id)">
            <span v-if="runningTool === row.id" class="dot dot-ok" aria-hidden="true"></span>
            <span class="dim">{{ runningTool === row.id ? "" : open.has(row.id) ? "▾" : "▸" }} {{ row.name }}</span>
            <span class="summary">{{ row.summary }}</span>
            <span class="note dim">
              <template v-if="runningTool === row.id">running · {{ clock(now - Date.parse(row.at)) }}</template>
              <template v-else-if="row.result">{{ resultNote(row.result) }}</template>
            </span>
          </button>
          <template v-if="open.has(row.id)">
            <pre v-if="row.diff" class="diff"><span
              v-for="(l, i) in row.diff" :key="i" :class="{ add: l.op === '+', del: l.op === '-' }">{{ l.op }} {{ l.text }}</span></pre>
            <pre v-else class="body">{{ formatInput(row.input) }}</pre>
            <pre v-if="row.result" class="body result">{{ row.result.text || "(no output)" }}</pre>
          </template>
        </div>
      </div>

      <div v-else-if="row.type === 'ask'" class="row">
        <span class="who ask">Asked</span>
        <div class="ask-line">Permission for <b>{{ row.name }}</b> <span class="mono">{{ row.summary }}</span></div>
      </div>

      <div v-else-if="row.type === 'result'" class="row">
        <span class="who"></span>
        <div class="turn" :class="{ failed: !row.ok }">{{ row.label }}</div>
      </div>
    </template>

    <div v-if="live" class="row">
      <span class="who agent">Agent</span>
      <div class="text pre live">{{ live }}<span class="cursor" aria-hidden="true"></span></div>
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
  color: var(--ink-3);
}
.who.agent { color: var(--blue); }
.who.ask { color: var(--amber); }
.pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.dim { color: var(--ink-3); }
.bubble {
  flex: 1;
  min-width: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  line-height: 1.5;
  color: var(--ink-2);
}
.text { flex: 1; min-width: 0; line-height: 1.55; }
.text.live { color: var(--ink-2); }
.cursor { display: inline-block; width: 8px; height: 14px; margin-left: 2px; background: var(--blue); vertical-align: text-bottom; }
.link { border: 0; background: none; padding: 0; margin-left: 6px; font: inherit; font-size: 13px; color: var(--blue); cursor: pointer; }
.thinking { flex: 1; min-width: 0; }
.thinking .link { margin-left: 0; color: var(--ink-3); }
.thinking p { margin: 6px 0 0; font-size: 13px; line-height: 1.5; }
.tool {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
  overflow: hidden;
  font-family: var(--mono);
  font-size: 12px;
}
.tool.running { border-color: var(--blue); }
.tool.failed { border-color: var(--danger); }
.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: none;
  font: inherit;
  color: var(--ink-2);
  text-align: left;
  cursor: pointer;
}
.tool-head:disabled { cursor: default; }
.summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { margin-left: auto; flex: none; padding-left: 8px; }
.body, .diff {
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border-soft);
  max-height: 360px;
  overflow: auto;
  line-height: 1.6;
  white-space: pre;
}
.body.result { color: var(--ink-2); }
.diff { padding: 8px 0; }
.diff span { display: block; padding: 0 12px; }
.diff .add { background: var(--add); }
.diff .del { background: var(--danger-tint); }
.ask-line { flex: 1; min-width: 0; color: var(--amber); overflow-wrap: anywhere; }
.ask-line .mono { font-size: 12px; }
.turn { font-size: 12px; color: var(--ink-3); }
.turn.failed { color: var(--danger); }
</style>
