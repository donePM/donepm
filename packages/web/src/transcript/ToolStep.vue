<script setup lang="ts">
import { computed } from "vue";
import AnsiText from "../ansi/AnsiText.vue";
import { clock } from "../time/duration";
import DiffView from "./DiffView.vue";
import { commandPreview, diffPreview, outputTail, resultNote, stepTime, type ToolRow } from "./rows";

/**
 * One tool call in the Agents view. Collapsed it still shows what matters: the command under a
 * described Bash call, the first lines of an edit, the end of a failed command's output, a todo
 * list. Opened it shows everything.
 */
const props = defineProps<{ row: ToolRow; open: boolean; running: boolean; now: number }>();
const emit = defineEmits<{ toggle: [] }>();

const PREVIEW_LINES = 6;
const command = computed(() => (props.row.command ? commandPreview(props.row.command) : undefined));
const preview = computed(() => (props.row.diff ? diffPreview(props.row.diff, PREVIEW_LINES) : undefined));
const moreDiff = computed(() => (props.row.diff && preview.value ? props.row.diff.length - preview.value.length : 0));
const failedTail = computed(() =>
  props.row.name === "Bash" && props.row.result?.isError && props.row.result.text ? outputTail(props.row.result.text) : "",
);
const note = computed(() => resultNote(props.row));
const stat = computed(() => (props.row.result && !props.row.result.isError ? props.row.diffStat : undefined));
/** Input that no preview shows: everything but Bash, edits and todos. */
const showInput = computed(() => props.row.name !== "Bash" && !props.row.diff && !props.row.todos);
const formatInput = (input: unknown) => JSON.stringify(input, null, 2);
</script>

<template>
  <div class="step" :class="{ running, failed: row.result?.isError }">
    <button class="head" type="button" :title="stepTime(row)" :aria-expanded="open" @click="emit('toggle')">
      <span v-if="running" class="dot primary" aria-hidden="true"></span>
      <span v-else class="caret" aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
      <span class="name">{{ row.name }}</span>
      <span class="summary">{{ row.summary }}</span>
      <span class="note">
        <template v-if="running">running · {{ clock(now - Date.parse(row.at)) }}</template>
        <template v-else-if="stat"><span class="plus">+{{ stat.added }}</span> <span class="minus">−{{ stat.removed }}</span></template>
        <template v-else>{{ note }}</template>
      </span>
    </button>

    <ul v-if="row.todos?.length" class="todos">
      <li v-for="(t, i) in row.todos" :key="i" :class="t.status">
        <span class="box" aria-hidden="true">{{ t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "" }}</span>
        <span class="sr">{{ t.status === "completed" ? "done:" : t.status === "in_progress" ? "doing:" : "to do:" }}</span>
        {{ t.content }}
      </li>
    </ul>

    <template v-if="!open">
      <div v-if="command" class="block cmd">
        <pre>{{ command.text }}</pre>
        <button v-if="command.more" class="link" type="button" @click="emit('toggle')">show all</button>
      </div>
      <div v-if="preview?.length" class="block diff">
        <DiffView :lines="preview" />
        <button v-if="moreDiff > 0" class="link" type="button" @click="emit('toggle')">show all ({{ moreDiff }} more lines)</button>
      </div>
      <pre v-if="failedTail" class="block tail"><AnsiText :text="failedTail" /></pre>
    </template>
    <template v-else>
      <pre v-if="row.command" class="block cmd">{{ row.command }}</pre>
      <DiffView v-if="row.diff" class="block diff" :lines="row.diff" />
      <pre v-if="showInput" class="block">{{ formatInput(row.input) }}</pre>
      <pre v-if="row.result && !row.todos" class="block result"><AnsiText :text="row.result.text || '(no output)'" /></pre>
    </template>
  </div>
</template>

<style scoped>
.step {
  flex: 1;
  min-width: 0;
  border-left: 2px solid transparent;
  border-radius: 6px;
  background: var(--card);
  overflow: hidden;
  font-family: var(--mono);
  font-size: 12px;
}
.step.running { border-left-color: var(--primary); }
.step.failed { border-left-color: var(--danger); }
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border: 0;
  background: none;
  font: inherit;
  color: var(--fg-2);
  text-align: left;
  cursor: pointer;
}
.head:hover { background: var(--muted); }
.caret { flex: none; width: 10px; color: var(--fg-3); }
.name { flex: none; color: var(--fg-3); }
.summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { margin-left: auto; flex: none; padding-left: 8px; color: var(--fg-3); }
.failed .note { color: var(--danger); }
.plus { color: var(--ok); }
.minus { color: var(--danger); }
.block {
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  max-height: 360px;
  overflow: auto;
  line-height: 1.6;
  white-space: pre;
}
.block pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.cmd { color: var(--fg-2); background: var(--muted); }
pre.cmd { white-space: pre-wrap; overflow-wrap: anywhere; }
.diff { padding: 0; }
.diff :deep(.diff) { max-height: none; padding: 4px 0; }
.diff .link { margin: 0 12px 6px; }
.tail { color: var(--fg-2); background: var(--danger-tint); }
.result { color: var(--fg-2); }
.link { border: 0; background: none; padding: 0; font: inherit; font-family: var(--sans); font-size: 12px; color: var(--primary); cursor: pointer; }
.todos { list-style: none; margin: 0; padding: 4px 12px 8px 28px; font-family: var(--sans); font-size: 13px; line-height: 1.6; color: var(--fg-2); }
.todos li { display: flex; gap: 8px; align-items: baseline; }
.todos .box {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border: 1px solid var(--border-2);
  border-radius: 3px;
  font-size: 9px;
  line-height: 1;
}
.todos .completed { color: var(--fg-3); text-decoration: line-through; }
.todos .completed .box { border-color: var(--ok); color: var(--ok); }
.todos .in_progress { color: var(--fg); font-weight: 500; }
.todos .in_progress .box { border-color: var(--primary); color: var(--primary); }
</style>
