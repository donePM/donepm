<script setup lang="ts">
import { ref } from "vue";
import { removeWorktree } from "../agents/actions";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { OpenTarget } from "../api/types";
import IconFolder from "../icons/IconFolder.vue";
import IconTerminal from "../icons/IconTerminal.vue";

/** `sessionId`: the agent's session, which Resume continues. */
const props = defineProps<{ itemId: string; path: string; removable: boolean; sessionId?: string }>();
const emit = defineEmits<{ removed: [] }>();
const error = ref<string>();
const removing = ref(false);

async function remove() {
  error.value = undefined;
  removing.value = true;
  try {
    await removeWorktree(props.itemId);
    emit("removed");
  } catch (e) {
    error.value = errorText(e);
  } finally {
    removing.value = false;
  }
}

async function open(target: OpenTarget) {
  error.value = undefined;
  try {
    await api.open(props.itemId, target);
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="wt-h">
    <h2 id="wt-h"><IconFolder />Worktree</h2>
    <p class="path mono">{{ path }}</p>
    <div class="buttons">
      <button class="btn sm" type="button" @click="open('finder')">Finder</button>
      <button class="btn sm" type="button" @click="open('terminal')"><IconTerminal class="ic-sm" />Terminal</button>
      <button
        v-if="removable"
        class="btn sm ghost danger end"
        type="button"
        :disabled="removing"
        title="git worktree remove; the branch is kept"
        @click="remove"
      >
        {{ removing ? "Removing…" : "Remove" }}
      </button>
    </div>
    <p v-if="sessionId" class="sub">session <span class="mono" :title="sessionId">{{ sessionId.slice(0, 4) }}…</span> · resumable</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 10px; }
h2 { display: flex; align-items: center; gap: 8px; }
h2 .ic { color: var(--fg-3); }
.path { margin: 0; color: var(--fg-3); line-height: 1.6; overflow-wrap: anywhere; user-select: all; }
.buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.end { margin-left: auto; }
.panel .sub { margin: 0; font-size: 12px; }
</style>
