<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { Draft, PrDraftPayload } from "../api/types";

const props = defineProps<{
  draft: Draft;
  createdAt?: string;
  agentRunning: boolean;
  /** Why publishing failed last time; approving again retries. */
  publishError?: string;
}>();
const emit = defineEmits<{ changed: [] }>();

const current = computed<PrDraftPayload>(() => props.draft.userEdits ?? props.draft.payload);
const title = ref("");
const body = ref("");
// A changed draft (the user's own save, or a new draft) resets the form to what is stored.
// Watching the values, not the object: every pushed reload brings a new object.
watch(
  [() => props.draft.id, () => current.value.title, () => current.value.body],
  () => {
    title.value = current.value.title;
    body.value = current.value.body;
  },
  { immediate: true },
);

const dirty = computed(() => title.value !== current.value.title || body.value !== current.value.body);
const rejecting = ref(false);
const reason = ref("");
const busy = ref(false);
const approving = ref(false);
/** The daemon is pushing (this tab's approve, or another one's). */
const publishing = computed(() => props.draft.state === "approved" || approving.value);
const error = ref<string>();

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = undefined;
  try {
    await fn();
    emit("changed");
  } catch (e) {
    // A failed publish comes back as the draft's publishError; no need to show it twice.
    if (isPublishFailure(e)) emit("changed");
    else error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function saveEdits() {
  if (!dirty.value) return;
  if (!title.value.trim()) throw new Error("The title cannot be empty.");
  await api.editDraft(props.draft.id, { title: title.value.trim(), body: body.value });
}

const save = () => run(saveEdits);
// Approve executes what the form shows, so unsaved edits are saved first.
const approve = () => run(async () => {
  await saveEdits();
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
  <section class="draft" aria-labelledby="draft-h">
    <div class="head">
      <h2 id="draft-h">Pull request draft</h2>
      <span class="meta">Created by agent<template v-if="createdAt"> · {{ createdAt }}</template> · editable</span>
    </div>
    <label class="field">
      <span>Title</span>
      <input v-model="title" class="input" type="text" :disabled="busy || publishing" />
    </label>
    <label class="field">
      <span>Body</span>
      <textarea v-model="body" class="textarea" rows="10" :disabled="busy || publishing"></textarea>
    </label>
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
      <button class="btn btn-primary" type="button" :disabled="busy || publishing" @click="approve">
        {{ publishing ? "Creating PR…" : publishError ? "Retry: approve and create PR" : "Approve and create PR" }}
      </button>
      <button
        class="btn"
        type="button"
        :disabled="busy || publishing || !agentRunning"
        :title="agentRunning ? undefined : 'The agent is not running, nobody would read the reason'"
        @click="rejecting = true"
      >
        Reject with reason…
      </button>
      <button v-if="dirty" class="btn" type="button" :disabled="busy" @click="save">Save edits</button>
      <span class="runs">Runs: git push · gh pr create</span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="publishError && !publishing" class="alert" role="alert">Creating the pull request failed: {{ publishError }}</p>
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
.reject { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border-soft); }
.runs { margin-left: auto; font-size: 12px; color: var(--ink-3); }
</style>
