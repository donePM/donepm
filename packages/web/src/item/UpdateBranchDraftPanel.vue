<script setup lang="ts">
import { DEPENDABOT_REBASE } from "@donepm/core";
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { UpdateBranchDraft } from "../api/types";

/**
 * The review agent asks to bring someone else's pull request up to date with its base (issue #148).
 * Approving updates the branch as the user and lets the agent go on with its review; rejecting
 * leaves the branch as it is.
 */
const props = defineProps<{
  draft: UpdateBranchDraft;
  createdAt?: string;
  /** A live agent hears the reason now; a stored session is resumed with it. */
  canReject: boolean;
  /** Why the update failed last time; approving again retries. */
  publishError?: string;
}>();
const emit = defineEmits<{ changed: [] }>();

const p = computed(() => props.draft.payload);
const dependabot = computed(() => p.value.via === "dependabot");
const runs = computed(() => (dependabot.value ? `gh: comment "${DEPENDABOT_REBASE}"` : `gh pr update-branch ${p.value.number}`));
const rejecting = ref(false);
const reason = ref("");
const busy = ref(false);
const approving = ref(false);
const updating = computed(() => props.draft.state === "approved" || approving.value);
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
  <section class="draft" aria-labelledby="update-branch-h">
    <div class="head">
      <h2 id="update-branch-h">
        Update the branch of <a :href="p.url" target="_blank" rel="noreferrer">PR #{{ p.number }}</a>
      </h2>
      <span class="meta">Created by agent<template v-if="createdAt"> · {{ createdAt }}</template></span>
    </div>
    <p class="what">
      <template v-if="dependabot">Asks Dependabot to rebase its branch onto <span class="mono">{{ p.base }}</span>.</template>
      <template v-else>Merges <span class="mono">{{ p.base }}</span> into the branch on GitHub, as you.</template>
      The agent then goes on with its review.
    </p>
    <p v-if="p.reason" class="reason">{{ p.reason }}</p>
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
      <button class="btn primary" type="button" :disabled="busy || updating" @click="approve">
        {{ updating ? "Updating…" : publishError ? "Retry: approve and update" : "Approve and update" }}
      </button>
      <button
        class="btn"
        type="button"
        :disabled="busy || updating || !canReject"
        :title="canReject ? undefined : 'The agent never started a session, nobody would read the reason'"
        @click="rejecting = true"
      >
        Reject with reason…
      </button>
      <span class="runs">Runs: {{ runs }}</span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="publishError && !updating" class="alert" role="alert">Updating failed: {{ publishError }}</p>
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
.reason { margin: 0; border-left: 2px solid var(--border); padding-left: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.reject { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border); }
.runs { margin-left: auto; font-size: 12px; color: var(--fg-3); }
</style>
