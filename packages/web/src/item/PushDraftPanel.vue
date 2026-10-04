<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { PushDraft } from "../api/types";

/** The agent's proposal to push new commits to the open PR (D35). Nothing to edit: push or reject. */
const props = defineProps<{
  draft: PushDraft;
  createdAt?: string;
  /** A live agent hears the reason now; a stored session is resumed with it. */
  canReject: boolean;
  /** Why pushing failed last time; approving again retries. */
  publishError?: string;
}>();
const emit = defineEmits<{ changed: [] }>();

const p = computed(() => props.draft.payload);
const rejecting = ref(false);
const reason = ref("");
const busy = ref(false);
const approving = ref(false);
const pushing = computed(() => props.draft.state === "approved" || approving.value);
const error = ref<string>();

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = undefined;
  try {
    await fn();
    emit("changed");
  } catch (e) {
    if (isPublishFailure(e)) emit("changed");
    else error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

const approve = () => run(async () => {
  approving.value = true;
  try {
    await api.approveDraft(props.draft.id);
  } finally {
    approving.value = false;
  }
});
const reject = () => run(async () => {
  await api.rejectDraft(props.draft.id, reason.value.trim() || undefined);
  rejecting.value = false;
  reason.value = "";
});
</script>

<template>
  <section class="draft" aria-labelledby="push-h">
    <div class="head">
      <h2 id="push-h">Push to <a :href="p.url" target="_blank" rel="noreferrer">PR #{{ p.number }}</a></h2>
      <span class="meta">Created by agent<template v-if="createdAt"> · {{ createdAt }}</template></span>
    </div>
    <p class="summary">{{ p.summary }}</p>
    <ul class="commits mono">
      <li v-for="c in p.commits" :key="c.sha"><span class="sha">{{ c.sha.slice(0, 7) }}</span> {{ c.subject }}</li>
      <li v-if="p.uncommitted" class="dim">Uncommitted changes, committed as “WIP from donePM”</li>
    </ul>
    <form v-if="rejecting" class="reject" @submit.prevent="reject">
      <label class="field">
        <span>Reason, sent to the agent as its next message</span>
        <textarea v-model="reason" class="textarea" rows="3" placeholder="What should change (optional)"></textarea>
      </label>
      <div class="actions">
        <button class="btn btn-danger" type="submit" :disabled="busy">Reject and send</button>
        <button class="btn" type="button" :disabled="busy" @click="rejecting = false">Cancel</button>
      </div>
    </form>
    <div v-else class="actions">
      <button class="btn btn-primary" type="button" :disabled="busy || pushing" @click="approve">
        {{ pushing ? "Pushing…" : publishError ? "Retry: approve and push" : "Approve and push" }}
      </button>
      <button
        class="btn"
        type="button"
        :disabled="busy || pushing || !canReject"
        :title="canReject ? undefined : 'The agent never started a session, nobody would read the reason'"
        @click="rejecting = true"
      >
        Reject with reason…
      </button>
      <span class="runs">Runs: git push {{ p.branch }}</span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="publishError && !pushing" class="alert" role="alert">Pushing failed: {{ publishError }}</p>
  </section>
</template>

<style scoped>
.draft {
  background: var(--card);
  border: 1px solid var(--amber-border);
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 15px; font-weight: 600; }
.meta { font-size: 12px; color: var(--ink-3); }
.summary { margin: 0; overflow-wrap: anywhere; }
.commits { margin: 0; padding-left: 18px; font-size: 13px; overflow-wrap: anywhere; }
.sha, .dim { color: var(--ink-3); }
.reject { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border-soft); }
.runs { margin-left: auto; font-size: 12px; color: var(--ink-3); }
</style>
