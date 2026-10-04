<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { ReviewDraft } from "../api/types";
import MarkdownView from "../markdown/MarkdownView.vue";
import type { RepoRef } from "../markdown/render";
import { VERDICT_LABEL } from "./review";

/**
 * The agent's review of someone else's pull request (D43): a verdict, a summary and inline
 * comments, posted as one review, as the user. Nothing to edit: approve or reject with a reason.
 */
const props = defineProps<{
  draft: ReviewDraft;
  repo?: RepoRef;
  createdAt?: string;
  /** A live agent hears the reason now; a stored session is resumed with it. */
  canReject: boolean;
  /** Why posting failed last time; approving again retries. */
  publishError?: string;
}>();
const emit = defineEmits<{ changed: [] }>();

const p = computed(() => props.draft.payload);
const runs = computed(() => {
  const n = p.value.comments.length;
  return `gh: 1 review${n ? ` with ${n === 1 ? "1 inline comment" : `${n} inline comments`}` : ""}`;
});
const rejecting = ref(false);
const reason = ref("");
const busy = ref(false);
const approving = ref(false);
const posting = computed(() => props.draft.state === "approved" || approving.value);
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
  <section class="draft" aria-labelledby="review-h">
    <div class="head">
      <h2 id="review-h">
        Review of <a :href="p.url" target="_blank" rel="noreferrer">PR #{{ p.number }}</a>
        <span class="verdict" :class="`v-${p.verdict}`">{{ VERDICT_LABEL[p.verdict] }}</span>
      </h2>
      <span class="meta">Created by agent<template v-if="createdAt"> · {{ createdAt }}</template></span>
    </div>
    <MarkdownView v-if="p.body" class="body" :source="p.body" :repo="repo" />
    <p v-else class="dim">No summary.</p>
    <template v-if="p.comments.length">
      <h3>Inline comments, on commit <span class="mono">{{ p.commitId.slice(0, 7) }}</span></h3>
      <ul class="comments">
        <li v-for="(c, i) in p.comments" :key="i">
          <span class="where mono">{{ c.path }}:{{ c.line }}</span>
          <MarkdownView :source="c.body" :repo="repo" />
        </li>
      </ul>
    </template>
    <form v-if="rejecting" class="reject" @submit.prevent="reject">
      <label class="field">
        <span>Reason, sent to the agent as its next message</span>
        <textarea v-model="reason" class="textarea" rows="3" placeholder="What should change (optional)"></textarea>
      </label>
      <div class="actions">
        <button class="btn danger" type="submit" :disabled="busy">Reject and send</button>
        <button class="btn" type="button" :disabled="busy" @click="rejecting = false">Cancel</button>
      </div>
    </form>
    <div v-else class="actions">
      <button class="btn primary" type="button" :disabled="busy || posting" @click="approve">
        {{ posting ? "Posting…" : publishError ? "Retry: approve and post" : "Approve and post" }}
      </button>
      <button
        class="btn"
        type="button"
        :disabled="busy || posting || !canReject"
        :title="canReject ? undefined : 'The agent never started a session, nobody would read the reason'"
        @click="rejecting = true"
      >
        Reject with reason…
      </button>
      <span class="runs">Runs: {{ runs }}</span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="publishError && !posting" class="alert" role="alert">Posting failed: {{ publishError }}</p>
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
h2 { margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--fg-2); }
.meta { font-size: 12px; color: var(--fg-3); }
.verdict { font-size: 12px; font-weight: 500; padding: 1px 7px; border-radius: 4px; border: 1px solid var(--border); color: var(--fg-2); }
.v-APPROVE { color: var(--ok); }
.v-REQUEST_CHANGES { color: var(--danger); }
.dim { margin: 0; color: var(--fg-3); }
.comments { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.comments li { border-left: 2px solid var(--border); padding-left: 12px; min-width: 0; }
.where { font-size: 12px; color: var(--fg-3); overflow-wrap: anywhere; }
.reject { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border); }
.runs { margin-left: auto; font-size: 12px; color: var(--fg-3); }
</style>
