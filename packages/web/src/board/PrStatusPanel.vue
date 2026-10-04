<script setup lang="ts">
import { conflictComment, prConflicts } from "@donepm/core";
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { ItemView } from "../api/types";
import { upsert } from "./items";
import { prStatusChips } from "./pr-status";

/**
 * Someone else's pull request on its card (D47): where it stands, and on a conflict a comment to its
 * author. donePM does not push to their branch; the user edits the text and the Post click is the
 * approval.
 */
const props = defineProps<{ item: ItemView }>();

const chips = computed(() => prStatusChips(props.item.prStatus));
const conflicting = computed(() => prConflicts(props.item));
const writing = ref(false);
const body = ref("");
const posting = ref(false);
const error = ref<string>();

function open() {
  body.value = conflictComment(props.item);
  error.value = undefined;
  writing.value = true;
}

async function post() {
  posting.value = true;
  error.value = undefined;
  try {
    upsert(await api.commentOnPr(props.item.id, body.value));
    writing.value = false;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    posting.value = false;
  }
}
</script>

<template>
  <div v-if="chips.length" class="pr-status">
    <div class="chips">
      <span v-for="c in chips" :key="c.text" class="chip" :class="`tone-${c.tone}`" :title="c.title">{{ c.text }}</span>
      <button v-if="conflicting && !writing" class="btn subtle ask" type="button" title="Ask the author to resolve the conflicts" @click="open">Ask author</button>
    </div>
    <form v-if="writing" class="comment" @submit.prevent="post">
      <label :for="`pr-comment-${item.id}`" class="sr-only">Comment on the pull request</label>
      <textarea :id="`pr-comment-${item.id}`" v-model="body" class="textarea mono" rows="3"></textarea>
      <div class="actions">
        <button class="btn btn-primary" type="submit" :disabled="posting || !body.trim()">{{ posting ? "Posting…" : "Post comment" }}</button>
        <button class="btn subtle" type="button" :disabled="posting" @click="writing = false">Cancel</button>
      </div>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.pr-status { display: flex; flex-direction: column; gap: 8px; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.chip { font-size: 11px; padding: 1px 7px; border-radius: 4px; border: 1px solid var(--border-soft); color: var(--ink-2); }
.chip.tone-ok { color: var(--green); border-color: currentColor; }
.chip.tone-bad { color: var(--danger); background: var(--danger-tint); border-color: transparent; }
.chip.tone-wait { color: var(--amber); border-color: var(--amber-border); }
.ask { margin-left: auto; font-size: 12px; }
.comment { display: flex; flex-direction: column; gap: 6px; }
.actions { display: flex; gap: 6px; }
</style>
