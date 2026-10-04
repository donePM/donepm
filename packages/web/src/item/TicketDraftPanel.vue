<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { TicketCommentDraft, TicketTransitionDraft } from "../api/types";

/**
 * The agent asks to comment on its Jira ticket, or to move it to another status (issue #139).
 * Approving does it as the user and lets the agent go on; rejecting leaves the ticket as it is.
 */
const props = defineProps<{
  draft: TicketCommentDraft | TicketTransitionDraft;
  createdAt?: string;
  /** A live agent hears the reason now; a stored session is resumed with it. */
  canReject: boolean;
  /** Why it failed last time; approving again retries. */
  publishError?: string;
}>();
const emit = defineEmits<{ changed: [] }>();

const move = computed(() => (props.draft.type === "ticket_transition" ? props.draft.payload : undefined));
const key = computed(() => props.draft.payload.key);
const url = computed(() => props.draft.payload.url);
const comment = computed(() => (props.draft.type === "ticket_comment" ? props.draft.payload.body : props.draft.payload.comment));
const rejecting = ref(false);
const reason = ref("");
const busy = ref(false);
const approving = ref(false);
const working = computed(() => props.draft.state === "approved" || approving.value);
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
const approveText = computed(() => {
  if (working.value) return move.value ? "Moving…" : "Posting…";
  const verb = move.value ? "move" : "post";
  return props.publishError ? `Retry: approve and ${verb}` : `Approve and ${verb}`;
});
</script>

<template>
  <section class="draft" aria-labelledby="ticket-draft-h">
    <div class="head">
      <h2 id="ticket-draft-h">
        <template v-if="move">Move <a :href="url" target="_blank" rel="noreferrer">{{ key }}</a> to {{ move.toStatus }}</template>
        <template v-else>Comment on <a :href="url" target="_blank" rel="noreferrer">{{ key }}</a></template>
      </h2>
      <span class="meta">Created by agent<template v-if="createdAt"> · {{ createdAt }}</template></span>
    </div>
    <p class="what">
      <template v-if="move">Moves the ticket in Jira as you<template v-if="comment">, with this comment</template>.</template>
      <template v-else>Posts this comment on the ticket in Jira as you.</template>
      The agent then goes on with its work.
    </p>
    <p v-if="comment" class="body">{{ comment }}</p>
    <form v-if="rejecting" class="reject" @submit.prevent="reject">
      <label class="field">
        <span>Reason, sent to the agent as its next message</span>
        <textarea v-model="reason" class="textarea" rows="3" placeholder="Why not (optional)"></textarea>
      </label>
      <div class="actions">
        <button class="btn danger" type="submit" :disabled="busy">Reject and send</button>
        <button class="btn" type="button" :disabled="busy" @click="rejecting = false">Cancel</button>
      </div>
    </form>
    <div v-else class="actions">
      <button class="btn primary" type="button" :disabled="busy || working" @click="approve">{{ approveText }}</button>
      <button
        class="btn"
        type="button"
        :disabled="busy || working || !canReject"
        :title="canReject ? undefined : 'The agent never started a session, nobody would read the reason'"
        @click="rejecting = true"
      >
        Reject with reason…
      </button>
      <span v-if="move" class="runs">Transition {{ move.transitionId }}</span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="publishError && !working" class="alert" role="alert">{{ move ? "Moving" : "Posting" }} failed: {{ publishError }}</p>
  </section>
</template>

<style scoped>
.draft {
  background: var(--card);
  border: 1px solid var(--attn-border);
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 15px; font-weight: 600; }
.meta { font-size: 12px; color: var(--fg-3); }
.what { margin: 0; color: var(--fg-2); }
.body { margin: 0; border-left: 2px solid var(--border); padding-left: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.reject { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border); }
.runs { margin-left: auto; font-size: 12px; color: var(--fg-3); }
</style>
