<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { WorktreeChoice } from "../api/client";
import type { WorktreeAtOldRoot } from "../api/types";
import { moveQuestion } from "./move-worktrees";

const props = defineProps<{ worktrees: WorktreeAtOldRoot[]; busy?: boolean }>();
const emit = defineEmits<{ choose: [choice: WorktreeChoice]; close: [] }>();

const dialog = ref<HTMLDialogElement>();
onMounted(() => dialog.value?.showModal());
const question = computed(() => moveQuestion(props.worktrees));
</script>

<template>
  <dialog ref="dialog" class="dialog" aria-labelledby="move-worktrees-title" @cancel.prevent="emit('close')">
    <div class="body">
      <h2 id="move-worktrees-title">{{ question.title }}</h2>
      <p class="hint">Moving keeps git's records right and the agent's session resumable. Left in place, they keep working where they are; new worktrees go to the new root.</p>
      <ul class="list">
        <li v-for="w in worktrees" :key="w.itemId">
          <span class="title">{{ w.title }}</span>
          <span class="mono path">{{ w.path }}</span>
          <span v-if="w.running" class="running">Agent running, stays</span>
        </li>
      </ul>
      <p v-if="question.note" class="hint">{{ question.note }}</p>
      <div class="buttons">
        <button class="btn" type="button" :disabled="busy" @click="emit('close')">Cancel</button>
        <span class="grow" />
        <button class="btn" type="button" :disabled="busy" @click="emit('choose', 'leave')">Leave them where they are</button>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="emit('choose', 'move')">{{ busy ? "Moving…" : "Move" }}</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.dialog { width: min(560px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--ink); }
.dialog::backdrop { background: rgb(20 20 19 / 40%); }
.body { display: flex; flex-direction: column; gap: 12px; padding: 20px; }
h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.hint { margin: 0; font-size: 12px; color: var(--ink-3); }
.list { list-style: none; margin: 0; padding: 0; max-height: 40vh; overflow: auto; }
li { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--border-soft); }
li:last-child { border-bottom: 0; }
.title { font-weight: 500; }
.path { font-size: 12px; color: var(--ink-3); overflow-wrap: anywhere; }
.running { font-size: 12px; color: var(--danger); }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.grow { flex: 1; }
</style>
