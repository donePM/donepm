<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { PrDraft, PrDraftPayload } from "../api/types";
import MarkdownView from "../markdown/MarkdownView.vue";
import type { RepoRef } from "../markdown/render";
import { draftTab, type DraftTab } from "./draft-tab";

const props = defineProps<{
  draft: PrDraft;
  createdAt?: string;
  /** A live agent hears the reason now; a stored session is resumed with it. */
  canReject: boolean;
  /** Why publishing failed last time; approving again retries. */
  publishError?: string;
  /** For `#123` and relative links in the preview. */
  repo?: RepoRef;
}>();
const emit = defineEmits<{ changed: [] }>();

const current = computed<PrDraftPayload>(() => props.draft.userEdits ?? props.draft.payload);
const title = ref("");
const body = ref("");
const tab = ref<DraftTab>("preview");
const dirty = computed(() => title.value !== current.value.title || body.value !== current.value.body);
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
// Only a new draft picks the tab again; the user's own save keeps the one they are on.
watch(() => props.draft.id, () => (tab.value = draftTab(dirty.value)), { immediate: true });

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
    <div class="field">
      <div class="body-head">
        <span id="draft-body-l">Body</span>
        <div class="tabs" role="tablist" aria-labelledby="draft-body-l">
          <button
            v-for="t in (['write', 'preview'] as const)"
            :key="t"
            type="button"
            role="tab"
            class="tab"
            :aria-selected="tab === t"
            @click="tab = t"
          >
            {{ t === "write" ? "Write" : "Preview" }}
          </button>
        </div>
      </div>
      <textarea
        v-if="tab === 'write'"
        v-model="body"
        class="textarea"
        rows="10"
        aria-labelledby="draft-body-l"
        :disabled="busy || publishing"
      ></textarea>
      <div v-else class="preview" role="tabpanel">
        <MarkdownView v-if="body.trim()" :source="body" :repo="repo" />
        <p v-else class="empty">Nothing to preview.</p>
      </div>
    </div>
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
        :disabled="busy || publishing || !canReject"
        :title="canReject ? undefined : 'The agent never started a session, nobody would read the reason'"
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
.body-head { display: flex; justify-content: space-between; align-items: end; gap: 12px; }
.body-head > span { font-size: 13px; color: var(--ink-2); }
.tabs { display: flex; gap: 2px; }
.tab {
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.tab:hover { color: var(--ink); }
.tab[aria-selected="true"] { border-color: var(--border-control); background: var(--card-muted); color: var(--ink); font-weight: 500; }
.tab:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
.preview { min-height: 120px; max-height: 480px; overflow: auto; padding: 10px 12px; border: 1px solid var(--border-soft); border-radius: 6px; }
.empty { margin: 0; color: var(--ink-3); }
.reject { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border-soft); }
.runs { margin-left: auto; font-size: 12px; color: var(--ink-3); }
</style>
