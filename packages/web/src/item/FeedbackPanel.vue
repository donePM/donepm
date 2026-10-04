<script setup lang="ts">
import { computed, ref } from "vue";
import { addressFeedback, dismissFeedback, pending } from "../agents/actions";
import { errorText } from "../api/errors";
import type { ItemDetail } from "../api/types";
import type { RepoRef } from "../markdown/render";
import FeedbackEntryView from "./FeedbackEntryView.vue";

/** Reviewers left feedback on the item's PR after it was done (D39): the item waits on the user. */
const props = defineProps<{ item: ItemDetail; repo?: RepoRef }>();
const emit = defineEmits<{ changed: [] }>();

const waiting = computed(() => (props.item.attention?.kind === "pr_feedback" ? props.item.attention : undefined));
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
  <section v-if="waiting" class="needs" aria-label="Review feedback">
    <h2>
      Review feedback on <a :href="waiting.pr.url" target="_blank" rel="noreferrer">PR #{{ waiting.pr.number }}</a>
    </h2>
    <div class="entries">
      <FeedbackEntryView v-for="e in waiting.entries" :key="`${e.kind}:${e.id}`" :entry="e" :repo="repo" />
    </div>
    <p class="hint">
      Address with agent resumes its session with these comments. It changes what needs changing and proposes a push draft with replies, or
      only replies. Nothing is posted until you approve.
    </p>
    <div class="actions">
      <button class="btn primary" type="button" :disabled="busy || !item.agentSessionId" @click="act(addressFeedback)">Address with agent</button>
      <button class="btn subtle" type="button" :disabled="busy" @click="act(dismissFeedback)">Mark done</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.needs {
  background: var(--attn-tint);
  border: 1px solid var(--attn-border);
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h2 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.entries { display: flex; flex-direction: column; gap: 10px; background: var(--card); border-radius: 6px; padding: 12px 14px; }
.hint { margin: 0; font-size: 13px; color: var(--fg-2); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
