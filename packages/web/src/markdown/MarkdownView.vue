<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown, type RepoRef } from "./render";

const props = defineProps<{
  source: string;
  /** Resolves relative links and `#123`. */
  repo?: RepoRef;
  /** Tighter spacing for the transcript. */
  compact?: boolean;
}>();

// Sanitized in renderMarkdown; nothing else may feed v-html.
const html = computed(() => renderMarkdown(props.source, props.repo));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="md" :class="{ compact }" v-html="html"></div>
</template>

<style scoped>
.md { color: var(--fg); line-height: 1.55; overflow-wrap: anywhere; min-width: 0; }
.md :deep(> :first-child) { margin-top: 0; }
.md :deep(> :last-child) { margin-bottom: 0; }
.md :deep(p), .md :deep(ul), .md :deep(ol), .md :deep(blockquote), .md :deep(pre), .md :deep(table) { margin: 0 0 12px; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4), .md :deep(h5), .md :deep(h6) {
  margin: 20px 0 8px;
  font-weight: 600;
  line-height: 1.3;
}
.md :deep(h1) { font-size: 20px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.md :deep(h2) { font-size: 17px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.md :deep(h3) { font-size: 15px; }
.md :deep(h4), .md :deep(h5), .md :deep(h6) { font-size: 14px; }
.md :deep(ul), .md :deep(ol) { padding-left: 24px; }
.md :deep(li + li) { margin-top: 2px; }
.md :deep(li > ul), .md :deep(li > ol) { margin: 2px 0 0; }
.md :deep(.contains-task-list) { list-style: none; padding-left: 4px; }
.md :deep(.task-list-item-checkbox) { margin: 0 6px 0 0; vertical-align: -1px; }
.md :deep(a:not([href])) { color: inherit; }
.md :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--muted);
}
.md :deep(pre) {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-fg);
  overflow-x: auto;
  overflow-wrap: normal;
}
.md :deep(pre code) { padding: 0; background: none; color: inherit; white-space: pre; }
.md :deep(blockquote) { padding: 0 12px; border-left: 3px solid var(--border); color: var(--fg-2); }
.md :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 16px 0; }
.md :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.md :deep(th), .md :deep(td) { padding: 5px 10px; border: 1px solid var(--border); text-align: left; }
.md :deep(th) { background: var(--muted); font-weight: 600; }
.md :deep(img) { max-width: 100%; }
.md :deep(details) { margin: 0 0 12px; }
.md :deep(summary) {
  cursor: pointer;
  width: fit-content;
  padding: 2px 6px;
  margin-left: -6px;
  border-radius: 4px;
  color: var(--fg-2);
  font-weight: 500;
}
.md :deep(summary:hover) { background: var(--muted); color: var(--fg); }
.md :deep(summary:focus-visible) { outline: 2px solid var(--primary-ring); outline-offset: 1px; }
.md :deep(details[open] > summary) { margin-bottom: 8px; }
.md :deep(details > :last-child) { margin-bottom: 0; }
.md :deep(kbd) {
  font-family: var(--mono);
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid var(--border-2);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--muted);
}

.md.compact { line-height: 1.5; }
.md.compact :deep(p), .md.compact :deep(ul), .md.compact :deep(ol), .md.compact :deep(blockquote),
.md.compact :deep(pre), .md.compact :deep(table), .md.compact :deep(details) { margin-bottom: 8px; }
.md.compact :deep(h1), .md.compact :deep(h2), .md.compact :deep(h3),
.md.compact :deep(h4), .md.compact :deep(h5), .md.compact :deep(h6) {
  margin: 12px 0 6px;
  font-size: 14px;
  padding: 0;
  border: 0;
}
</style>
