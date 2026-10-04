<script setup lang="ts">
import type { DraftReply, FeedbackEntry } from "../api/types";
import MarkdownView from "../markdown/MarkdownView.vue";
import type { RepoRef } from "../markdown/render";
import { replyTarget } from "./replies";

/** The replies a draft would post (D39), each with what it answers. `posted`: indices already out. */
defineProps<{ replies: DraftReply[]; feedback: FeedbackEntry[]; posted?: number[]; repo?: RepoRef }>();
</script>

<template>
  <ol class="replies">
    <li v-for="(r, i) in replies" :key="i">
      <p class="to">
        {{ replyTarget(r, feedback) }}
        <span v-if="posted?.includes(i)" class="done">posted</span>
      </p>
      <MarkdownView :source="r.body" :repo="repo" compact />
    </li>
  </ol>
</template>

<style scoped>
.replies { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 10px; }
.to { margin: 0 0 4px; font-size: 12px; color: var(--ink-3); overflow-wrap: anywhere; }
.done { margin-left: 6px; color: var(--green); }
</style>
