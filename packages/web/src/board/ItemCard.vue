<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { pending, startAgent, stopAgent } from "../agents/actions";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { ItemView } from "../api/types";
import AskPanel from "../asks/AskPanel.vue";
import { diffFiles, diffStats, type DiffStats } from "../diff/files";
import { clock } from "../time/duration";
import { columnOf, displayId, labelTone } from "./columns";

const props = defineProps<{ item: ItemView; repoRoot?: string; now: number }>();

const noClone = computed(() => props.item.badges.includes("no-local-clone"));
const closedUpstream = computed(() => props.item.badges.includes("closed-upstream"));
const column = computed(() => columnOf(props.item));
const busy = computed(() => pending.value.has(props.item.id));
/** Ready and failed items can start; a failed one starts again from its worktree. */
const startable = computed(() => (props.item.state === "ready" || props.item.state === "failed") && !noClone.value);
const elapsed = computed(() =>
  props.item.agent.startedAt ? clock(props.now - Date.parse(props.item.agent.startedAt)) : undefined,
);

const attention = computed(() => props.item.attention);
const FLAG = { ask: "Permission", draft: "PR draft", failed: "Failed" } as const;

/** `+84 −12 · 5 files · 2 commits` for a pending draft, loaded once per draft. */
const draftStats = ref<DiffStats & { commits: number }>();
watch(
  () => (attention.value?.kind === "draft" ? attention.value.draftId : undefined),
  async (draftId) => {
    draftStats.value = undefined;
    if (!draftId) return;
    try {
      const d = await api.diff(props.item.id);
      draftStats.value = { ...diffStats(diffFiles(d.patch)), commits: d.commits };
    } catch {
      // The stats are a hint; the detail view shows the error.
    }
  },
  { immediate: true },
);

/** Last lines only; the detail view shows all of it. */
const stderrTail = computed(() =>
  attention.value?.kind === "failed" ? attention.value.stderrTail?.trimEnd().split("\n").slice(-6).join("\n") : undefined,
);

const error = ref<string>();
async function act(fn: (id: string) => Promise<void>) {
  error.value = undefined;
  try {
    await fn(props.item.id);
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <article class="card" :class="[`in-${column}`, { muted: noClone }]">
    <div class="meta mono">
      <a :href="item.externalUrl" target="_blank" rel="noreferrer" class="ext">{{ displayId(item.externalId) }}</a>
      <span v-if="item.state === 'running'" class="live"><span class="dot dot-ok" aria-hidden="true"></span>running<template v-if="elapsed"> · {{ elapsed }}</template></span>
      <span v-else-if="attention" class="flag">{{ FLAG[attention.kind] }}</span>
      <span v-else-if="column === 'needs_you' && !noClone" class="playbook" title="Playbook">{{ item.playbook }}</span>
    </div>
    <h3><RouterLink :to="{ name: 'item', params: { id: item.id } }" class="title">{{ item.title }}</RouterLink></h3>
    <div v-if="item.labels.length" class="labels">
      <span v-for="l in item.labels" :key="l" class="label" :class="`tone-${labelTone(l)}`">{{ l }}</span>
    </div>
    <div v-if="noClone" class="note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle><path d="M12 8v4m0 4h.01"></path>
      </svg>
      No local clone<template v-if="repoRoot"> under {{ repoRoot }}</template>
    </div>
    <div v-if="closedUpstream" class="note warn">Closed on GitHub</div>
    <div v-if="item.state === 'running'" class="activity mono">
      <span v-if="item.branch">{{ item.branch }}</span>
      <span v-if="item.agent.currentTool" class="dim">{{ item.agent.currentTool.name }} · {{ item.agent.currentTool.summary }}</span>
      <span v-else-if="!item.agent.startedAt || !item.worktreePath" class="dim">preparing worktree…</span>
    </div>
    <AskPanel v-if="attention?.kind === 'ask'" :ask-id="attention.askId" :tool-name="attention.toolName" :input="attention.input" />
    <template v-else-if="attention?.kind === 'draft'">
      <div class="stats mono">
        <template v-if="draftStats">
          <span class="add">+{{ draftStats.additions }}</span> <span class="del">−{{ draftStats.deletions }}</span>
          · {{ draftStats.files }} {{ draftStats.files === 1 ? "file" : "files" }} · {{ draftStats.commits }} {{ draftStats.commits === 1 ? "commit" : "commits" }}
        </template>
        <template v-else>{{ attention.title }}</template>
      </div>
      <div class="actions">
        <RouterLink :to="{ name: 'item', params: { id: item.id } }" class="btn btn-amber">Review draft</RouterLink>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'failed'">
      <p class="reason">{{ attention.reason }}</p>
      <pre v-if="stderrTail" class="stderr mono">{{ stderrTail }}</pre>
    </template>
    <div v-if="startable" class="actions">
      <label :for="`pb-${item.id}`" class="sr-only">Playbook</label>
      <select :id="`pb-${item.id}`" class="select" :value="item.playbook" disabled title="More playbooks come later">
        <option :value="item.playbook">{{ item.playbook }}</option>
      </select>
      <button class="btn btn-primary" type="button" :disabled="busy" @click="act(startAgent)">
        {{ item.state === "failed" ? "Retry" : "Start" }}
      </button>
    </div>
    <div v-else-if="item.state === 'running' || (item.agent.running && column === 'needs_you' && attention?.kind !== 'draft')" class="actions">
      <RouterLink :to="{ name: 'agent', params: { id: item.id } }" class="btn">Transcript</RouterLink>
      <button v-if="item.agent.running" class="btn stop" type="button" :disabled="busy" @click="act(stopAgent)">Stop</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card.in-in_progress { border-color: var(--blue); }
.card.in-needs_you { background: var(--amber-tint); border-color: var(--amber-border); }
.card.muted { background: var(--card-muted); border: 1px dashed var(--border-control); color: var(--ink-3); }
.card.muted h3, .card.in-done h3 { color: var(--ink-2); }
.meta { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12px; color: var(--ink-3); }
.ext { color: inherit; text-decoration: none; min-width: 0; overflow-wrap: anywhere; }
.ext:hover { color: var(--blue); text-decoration: underline; }
.playbook {
  flex: none;
  font-size: 11px;
  padding: 1px 7px;
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  color: var(--ink-2);
}
.flag { flex: none; color: var(--amber); font-family: var(--sans); font-weight: 500; }
h3 { margin: 0; font-size: 14px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
.title { color: inherit; text-decoration: none; }
.title:hover { color: var(--blue); text-decoration: underline; }
.stats { font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.add { color: #15803d; }
.del { color: var(--danger); }
.reason { margin: 0; font-size: 13px; color: var(--ink-2); overflow-wrap: anywhere; }
.stderr {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-ink);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 120px;
  overflow: auto;
}
.labels { display: flex; gap: 6px; flex-wrap: wrap; }
.label { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--border-soft); color: var(--ink-2); }
.label.tone-bug { background: var(--danger-tint); color: var(--danger); }
.label.tone-feature { background: var(--blue-tint); color: var(--blue); }
.note { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.note.warn { color: var(--amber); }
.live { flex: none; display: flex; align-items: center; gap: 6px; color: var(--blue); }
.activity { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.dim { color: var(--ink-3); }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.actions .btn { display: inline-flex; align-items: center; text-decoration: none; }
.select {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border-control);
  border-radius: 6px;
  background: var(--card);
  font: inherit;
  font-size: 13px;
  color: var(--ink);
}
.stop { color: var(--danger); font-weight: 400; }
.error { margin: 0; padding: 8px 10px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
