<script setup lang="ts">
import { computed } from "vue";
import type { FeedbackEntry } from "../api/types";
import MarkdownView from "../markdown/MarkdownView.vue";
import type { RepoRef } from "../markdown/render";

/** One review, inline comment or conversation comment on the item's PR (D39). */
const props = defineProps<{ entry: FeedbackEntry; repo?: RepoRef }>();

const what = computed(() => {
  const e = props.entry;
  if (e.kind === "review") return e.state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed";
  if (e.kind === "inline") return "commented on";
  return "commented";
});
/** The last lines of the hunk, up to the commented line. */
const hunk = computed(() => props.entry.diffHunk?.split("\n").slice(-6).join("\n"));
</script>

<template>
  <article class="entry">
    <p class="head">
      <strong>@{{ entry.author }}</strong> {{ what }}
      <template v-if="entry.kind === 'inline'">
        <span class="mono">{{ entry.path }}<template v-if="entry.line">:{{ entry.line }}</template></span>
      </template>
      <a :href="entry.url" target="_blank" rel="noreferrer" class="link">on GitHub</a>
    </p>
    <pre v-if="hunk" class="hunk mono on-code">{{ hunk }}</pre>
    <MarkdownView v-if="entry.body.trim()" :source="entry.body" :repo="repo" compact />
  </article>
</template>

<style scoped>
.entry { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border-soft); }
.entry:first-child { border-top: 0; padding-top: 0; }
.head { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.link { margin-left: 6px; font-size: 12px; }
.hunk {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-ink);
  font-size: 12px;
  white-space: pre;
  overflow: auto;
}
</style>
