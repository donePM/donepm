<script setup lang="ts">
import { conflictComment, MERGE_METHODS, prConflicts, type MergeMethod } from "@donepm/core";
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { ItemView } from "../api/types";
import { upsert } from "./items";
import { prStatusChips, type ChipTone } from "./pr-status";

const TONES: Record<ChipTone, string> = { ok: "ok", bad: "danger", wait: "attn", plain: "" };

/**
 * Someone else's pull request on its card (D47): where it stands, and on a conflict a comment to its
 * author. donePM does not push to their branch; the user edits the text and the Post click is the
 * approval. Once the user approved it, its checks passed and it is mergeable, Merge merges it; the
 * checkbox lets the daemon do that on its own.
 */
const props = defineProps<{ item: ItemView }>();

const chips = computed(() => prStatusChips(props.item.prStatus));
const conflicting = computed(() => prConflicts(props.item));
const writing = ref(false);
const body = ref("");
const posting = ref(false);
const error = ref<string>();
const method = ref<MergeMethod>(props.item.merge?.method ?? "squash");
const merging = ref(false);
const blocked = computed(() => props.item.merge?.blockers ?? []);

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

async function merge() {
  merging.value = true;
  error.value = undefined;
  try {
    upsert(await api.mergePr(props.item.id, method.value));
  } catch (e) {
    error.value = errorText(e);
  } finally {
    merging.value = false;
  }
}

async function setAuto(on: boolean) {
  error.value = undefined;
  try {
    upsert(await api.setAutoMerge(props.item.id, on));
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <div v-if="chips.length || item.merge" class="pr-status">
    <div class="chips">
      <span v-for="c in chips" :key="c.text" class="badge" :class="TONES[c.tone]" :title="c.title">{{ c.text }}</span>
      <button v-if="conflicting && !writing" class="btn ghost sm ask" type="button" title="Ask the author to resolve the conflicts" @click="open">Ask author</button>
    </div>
    <form v-if="writing" class="comment" @submit.prevent="post">
      <label :for="`pr-comment-${item.id}`" class="sr">Comment on the pull request</label>
      <textarea :id="`pr-comment-${item.id}`" v-model="body" class="textarea mono" rows="3"></textarea>
      <div class="actions">
        <button class="btn sm primary" type="submit" :disabled="posting || !body.trim()">{{ posting ? "Posting…" : "Post comment" }}</button>
        <button class="btn sm ghost" type="button" :disabled="posting" @click="writing = false">Cancel</button>
      </div>
    </form>
    <div v-if="item.merge" class="merge">
      <label :for="`merge-method-${item.id}`" class="sr">Merge method</label>
      <select :id="`merge-method-${item.id}`" v-model="method" class="select method" :disabled="merging">
        <option v-for="m in MERGE_METHODS" :key="m" :value="m">{{ m }}</option>
      </select>
      <button
        class="btn sm"
        type="button"
        :disabled="merging || blocked.length > 0"
        :title="blocked.length ? `Not yet: ${blocked.join(', ')}` : 'Merge the pull request on GitHub'"
        @click="merge"
      >
        {{ merging ? "Merging…" : "Merge" }}
      </button>
      <label class="check auto" title="Merge it on its own once you approved it, its checks passed and it is mergeable">
        <input type="checkbox" :checked="item.merge.auto" @change="setAuto(($event.target as HTMLInputElement).checked)" />
        Merge automatically
      </label>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.pr-status { display: flex; flex-direction: column; gap: 8px; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.ask { margin-left: auto; }
.comment { display: flex; flex-direction: column; gap: 6px; }
.actions { display: flex; gap: 6px; }
.merge { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.method { width: auto; height: 28px; font-size: 12px; }
.auto { gap: 6px; color: var(--fg-2); }
.auto input { width: 14px; height: 14px; }
</style>
