<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ItemDiff } from "../api/types";
import { diffFiles, diffStats } from "./files";

const props = defineProps<{ diff?: ItemDiff; loading: boolean; error?: string }>();
const emit = defineEmits<{ refresh: [] }>();

const files = computed(() => diffFiles(props.diff?.patch ?? ""));
const stats = computed(() => diffStats(files.value));

/** Small diffs open fully; larger ones show the file list and open on click. */
const AUTO_OPEN_LINES = 400;
const open = ref(new Set<string>());
watch(files, (list) => {
  const total = list.reduce((n, f) => n + f.additions + f.deletions, 0);
  open.value = new Set(total <= AUTO_OPEN_LINES ? list.map(key) : []);
}, { immediate: true });

function key(f: { path: string; oldPath?: string }) {
  return `${f.oldPath ?? ""}→${f.path}`;
}
function toggle(k: string) {
  const next = new Set(open.value);
  if (!next.delete(k)) next.add(k);
  open.value = next;
}
</script>

<template>
  <section class="changes" aria-labelledby="changes-h">
    <div class="head">
      <h2 id="changes-h">Changes</h2>
      <span v-if="diff" class="sub">
        {{ stats.files }} {{ stats.files === 1 ? "file" : "files" }} · {{ diff.base }}...{{ diff.branch }}, uncommitted included
      </span>
      <button class="btn refresh" type="button" :disabled="loading" @click="emit('refresh')">{{ loading ? "Loading…" : "Refresh" }}</button>
    </div>
    <p v-if="error" class="alert msg" role="alert">{{ error }}</p>
    <p v-else-if="diff && !files.length" class="empty">No changes yet.</p>
    <div v-for="f in files" :key="key(f)" class="file">
      <button class="file-head mono" type="button" :aria-expanded="open.has(key(f))" @click="toggle(key(f))">
        <span class="path">
          <template v-if="f.oldPath">{{ f.oldPath }} → </template>{{ f.path }}
          <span v-if="f.status === 'added'" class="tag">new</span>
          <span v-else-if="f.status === 'deleted'" class="tag">deleted</span>
        </span>
        <span class="count">
          <span v-if="f.binary" class="dim">binary</span>
          <span v-if="f.additions" class="add">+{{ f.additions }}</span>
          <span v-if="f.deletions" class="del">−{{ f.deletions }}</span>
        </span>
      </button>
      <div v-if="open.has(key(f)) && f.hunks.length" class="hunks mono">
        <template v-for="(h, hi) in f.hunks" :key="hi">
          <div class="line hunk">{{ h.header }}</div>
          <div v-for="(l, li) in h.lines" :key="li" class="line" :class="l.kind">
            <span class="sign" aria-hidden="true">{{ l.kind === "add" ? "+" : l.kind === "del" ? "-" : " " }}</span>{{ l.text }}
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.changes { background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.head { display: flex; align-items: baseline; gap: 12px; padding: 14px 20px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 15px; font-weight: 600; }
.sub { font-size: 12px; color: var(--ink-3); overflow-wrap: anywhere; }
.refresh { margin-left: auto; height: 28px; font-size: 12px; }
.msg { margin: 0 20px 14px; }
.empty { margin: 0; padding: 0 20px 16px; color: var(--ink-3); }
.file { border-top: 1px solid var(--border-soft); }
.file-head {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border: 0;
  background: var(--card-muted);
  font-size: 12px;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.file-head:hover { background: var(--border-soft); }
.path { min-width: 0; overflow-wrap: anywhere; }
.tag { margin-left: 6px; font-family: var(--sans); font-size: 11px; color: var(--ink-3); }
.count { flex: none; display: flex; gap: 8px; }
.add { color: #15803d; }
.del { color: var(--danger); }
.dim { color: var(--ink-3); }
.hunks { font-size: 12px; overflow-x: auto; }
.line { white-space: pre; padding: 1px 20px; min-width: max-content; }
.line.add { background: var(--add); }
.line.del { background: var(--danger-tint); }
.line.hunk, .line.meta { color: var(--ink-3); }
.line.hunk { padding-top: 8px; padding-bottom: 4px; }
.sign { display: inline-block; width: 2ch; color: var(--ink-3); user-select: none; }
</style>
