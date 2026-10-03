<script setup lang="ts">
import { computed } from "vue";
import type { ItemView } from "../api/types";
import { columnOf, displayId, labelTone } from "./columns";

const props = defineProps<{ item: ItemView; repoRoot?: string }>();

const noClone = computed(() => props.item.badges.includes("no-local-clone"));
const closedUpstream = computed(() => props.item.badges.includes("closed-upstream"));
const column = computed(() => columnOf(props.item));
</script>

<template>
  <article class="card" :class="[`in-${column}`, { muted: noClone }]">
    <div class="meta mono">
      <a :href="item.externalUrl" target="_blank" rel="noreferrer" class="ext">{{ displayId(item.externalId) }}</a>
      <span v-if="item.state === 'failed'" class="flag">Failed</span>
      <span v-else-if="column !== 'done' && !noClone" class="playbook" title="Playbook">{{ item.playbook }}</span>
    </div>
    <h3>{{ item.title }}</h3>
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
.labels { display: flex; gap: 6px; flex-wrap: wrap; }
.label { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--border-soft); color: var(--ink-2); }
.label.tone-bug { background: var(--danger-tint); color: var(--danger); }
.label.tone-feature { background: var(--blue-tint); color: var(--blue); }
.note { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.note.warn { color: var(--amber); }
</style>
