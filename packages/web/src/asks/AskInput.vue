<script setup lang="ts">
import { computed, ref } from "vue";
import DiffView from "../transcript/DiffView.vue";
import { askCopyText, askView } from "./view";

const props = defineProps<{ toolName: string; input: unknown; worktree?: string }>();

/** Everything the agent wants to run or change, never cut (issue #67). */
const view = computed(() => askView(props.toolName, props.input, props.worktree));

const copied = ref(false);
async function copy() {
  const text = askCopyText(view.value);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="input">
    <p v-if="view.kind === 'command' && view.description" class="description">{{ view.description }}</p>
    <div v-if="view.kind === 'edit'" class="edit">
      <div class="path mono">{{ view.path }}</div>
      <DiffView :lines="view.diff" />
    </div>
    <div v-else class="code mono">
      <button class="copy" type="button" :title="copied ? 'Copied' : 'Copy to the clipboard'" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
      <pre :class="{ target: view.kind === 'target' }">{{ view.kind === "command" ? view.command : view.kind === "target" ? view.target : view.text }}</pre>
    </div>
    <p v-if="view.kind === 'command' && view.cwd" class="cwd">in <span class="mono">{{ view.cwd }}</span></p>
  </div>
</template>

<style scoped>
.input { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.description { margin: 0; font-size: 13px; color: var(--ink-2); }
.code { position: relative; background: var(--code-bg); color: var(--code-ink); border-radius: 6px; padding: 10px 12px; font-size: 12px; }
pre { margin: 0; padding-right: 48px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; font: inherit; }
pre.target { font-size: 14px; font-weight: 600; }
.copy {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 8px;
  border: 1px solid #55554f;
  border-radius: 4px;
  background: none;
  color: #9a9a92;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.copy:hover { color: var(--code-ink); }
.edit { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--card); }
.path { padding: 6px 12px; border-bottom: 1px solid var(--border-soft); font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.cwd { margin: 0; font-size: 12px; color: var(--muted, #6b6b63); }
</style>
