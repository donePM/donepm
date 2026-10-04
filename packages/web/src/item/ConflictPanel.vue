<script setup lang="ts">
import { computed, ref } from "vue";
import { dismissConflict, pending, resolveConflict } from "../agents/actions";
import { errorText } from "../api/errors";
import type { ItemDetail } from "../api/types";

/** The item's PR conflicts with its base (D36): waiting on the user, or taken on by them. */
const props = defineProps<{ item: ItemDetail }>();
const emit = defineEmits<{ changed: [] }>();

const waiting = computed(() => (props.item.attention?.kind === "pr_conflict" ? props.item.attention : undefined));
/** The user said they resolve it themselves; it shows until GitHub reports the PR mergeable. */
const open = computed(() => (props.item.pr?.conflict && !props.item.pr.conflict.waiting ? props.item.pr.conflict : undefined));
const busy = computed(() => pending.value.has(props.item.id));

const error = ref<string>();
async function act(fn: (id: string) => Promise<void>) {
  error.value = undefined;
  try {
    await fn(props.item.id);
    emit("changed");
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <section v-if="waiting" class="needs" aria-label="Merge conflict">
    <h2>
      <a :href="waiting.pr.url" target="_blank" rel="noreferrer">PR #{{ waiting.pr.number }}</a> has merge conflicts with
      <span class="mono">{{ waiting.base }}</span>
    </h2>
    <ul v-if="waiting.files.length" class="files mono">
      <li v-for="f in waiting.files" :key="f">{{ f }}</li>
    </ul>
    <p class="hint">
      Resolve with agent fetches <span class="mono">{{ waiting.base }}</span> and resumes its session. It merges, runs the tests and proposes
      the result as a push draft.
    </p>
    <div class="actions">
      <button class="btn primary" type="button" :disabled="busy || !item.agentSessionId" @click="act(resolveConflict)">Resolve with agent</button>
      <button class="btn subtle" type="button" :disabled="busy" @click="act(dismissConflict)">I'll do it myself</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </section>
  <section v-else-if="open && item.pr" class="panel" aria-label="Merge conflict">
    <h2>
      <a :href="item.pr.url" target="_blank" rel="noreferrer">PR #{{ item.pr.number }}</a> has merge conflicts with
      <span class="mono">{{ open.base }}</span>
    </h2>
    <ul v-if="open.files.length" class="files mono">
      <li v-for="f in open.files" :key="f">{{ f }}</li>
    </ul>
    <p class="hint">This note goes away once GitHub reports the pull request mergeable again.</p>
  </section>
</template>

<style scoped>
.needs, .panel { border-radius: 8px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.needs { background: var(--attn-tint); border: 1px solid var(--attn-border); }
.panel { background: var(--card); border: 1px solid var(--border); }
h2 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.hint { margin: 0; font-size: 13px; color: var(--fg-2); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.files { margin: 0; padding-left: 18px; font-size: 12px; overflow-wrap: anywhere; }
</style>
