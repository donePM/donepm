<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { loadCollapsed, saveCollapsed, toggleCollapsed } from "./collapsed";
import { COLUMNS } from "./columns";
import ItemCard from "./ItemCard.vue";
import { items, itemsError, itemsLoaded, watchItems } from "./items";
import { buildLanes, NO_CLONE_KEY, sortLanes, stableOrder, type Lane } from "./lanes";
import { useNow } from "../time/now";

watchItems();

const repoRoot = ref<string>();
const removeOnMerge = ref(false);
onMounted(() =>
  api.settings().then(
    (s) => {
      repoRoot.value = s.repoRoot;
      removeOnMerge.value = s.removeWorktreeOnMerge;
    },
    () => undefined,
  ),
);

const now = useNow(1000);

/** Lane order while the page is open; not reactive, it only seeds the next ordering. A reload re-sorts. */
let laneOrder: string[] = [];
const lanes = computed(() => {
  const ordered = stableOrder(sortLanes(buildLanes(items.value)), laneOrder);
  laneOrder = ordered.map((l) => l.key);
  return ordered;
});

const totals = computed(() =>
  Object.fromEntries(COLUMNS.map((c) => [c.key, lanes.value.reduce((n, l) => n + l.counts[c.key], 0)])),
);

const collapsed = ref(loadCollapsed());
const isCollapsed = (lane: Lane) => collapsed.value.has(lane.key);
function toggle(lane: Lane) {
  collapsed.value = toggleCollapsed(collapsed.value, lane.key);
  saveCollapsed(collapsed.value);
}

/** Only columns that have cards; zero counts stay out of the lane header. */
const shownCounts = (lane: Lane) => COLUMNS.filter((c) => lane.counts[c.key] > 0);
</script>

<template>
  <div class="page">
    <p v-if="itemsError" class="error" role="alert">Could not load items: {{ itemsError }}</p>
    <main class="board">
      <div class="colhead">
        <div v-for="col in COLUMNS" :key="col.key" class="cell">
          <h2 :class="{ amber: col.key === 'needs_you' }">{{ col.title }}</h2>
          <span class="count">{{ totals[col.key] }}</span>
          <RouterLink v-if="col.key === 'done'" to="/archive" class="archive-link">Archive</RouterLink>
        </div>
      </div>
      <p v-if="itemsLoaded && !lanes.length" class="empty">
        Nothing to do in the repositories you manage. Choose them in <RouterLink to="/settings/repositories">Settings</RouterLink>.
      </p>
      <section v-for="lane in lanes" :key="lane.key" class="lane" :aria-labelledby="`lane-${lane.key}`">
        <h3 class="lane-head">
          <button
            :id="`lane-${lane.key}`"
            class="toggle"
            type="button"
            :aria-expanded="!isCollapsed(lane)"
            :aria-controls="`lane-body-${lane.key}`"
            @click="toggle(lane)"
          >
            <svg class="chevron" :class="{ closed: isCollapsed(lane) }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6"></path>
            </svg>
            <span class="name" :class="{ muted: lane.key === NO_CLONE_KEY }">{{ lane.name }}</span>
            <span class="counts">
              <span v-for="col in shownCounts(lane)" :key="col.key" class="n" :class="{ amber: col.key === 'needs_you' }">{{ col.title }} {{ lane.counts[col.key] }}</span>
            </span>
          </button>
        </h3>
        <div v-show="!isCollapsed(lane)" :id="`lane-body-${lane.key}`" class="lane-body">
          <div
            v-for="col in COLUMNS"
            :key="col.key"
            class="col"
            :class="{ none: !lane.columns[col.key].length }"
            role="group"
            :aria-label="col.title"
          >
            <h4 class="subhead" :class="{ amber: col.key === 'needs_you' }">{{ col.title }} <span class="count">{{ lane.counts[col.key] }}</span></h4>
            <ItemCard
              v-for="item in lane.columns[col.key]"
              :key="item.id"
              :item="item"
              :repo-root="repoRoot"
              :remove-on-merge="removeOnMerge"
              :now="now"
              :hide-repo="lane.key !== NO_CLONE_KEY"
            />
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100%; }
/* The board is its own scroll container, so the sticky headers hold wherever the page is. */
.board {
  --cols: repeat(4, minmax(0, 1fr));
  --gap: 16px;
  /* Lane headers stick right below the column header. */
  --colhead-h: 44px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 24px 24px;
}
.colhead {
  position: sticky;
  top: 0;
  z-index: 3;
  display: grid;
  grid-template-columns: var(--cols);
  gap: var(--gap);
  align-items: end;
  height: var(--colhead-h);
  padding: 0 0 8px;
  background: var(--bg);
}
.cell { display: flex; align-items: baseline; gap: 8px; padding: 0 4px; min-width: 0; }
h2, .subhead { margin: 0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-2); }
h2.amber, .subhead.amber { color: var(--attn); }
.count { font-size: 12px; font-weight: 400; color: var(--fg-3); }
.archive-link { margin-left: auto; font-size: 12px; color: var(--fg-3); text-decoration: none; }
.archive-link:hover { color: var(--primary); text-decoration: underline; }
.lane { margin-bottom: 12px; }
.lane-head {
  position: sticky;
  top: var(--colhead-h);
  z-index: 2;
  margin: 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.toggle:hover { background: var(--muted); }
.toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.chevron { flex: none; color: var(--fg-3); }
.chevron.closed { transform: rotate(-90deg); }
.name { font-weight: 600; overflow-wrap: anywhere; }
.name.muted { color: var(--fg-3); }
.counts { display: flex; flex-wrap: wrap; font-size: 12px; color: var(--fg-3); }
.n + .n::before { content: "·"; margin: 0 6px; }
.n.amber { color: var(--attn); font-weight: 600; }
.lane-body {
  display: grid;
  grid-template-columns: var(--cols);
  gap: var(--gap);
  align-items: start;
  padding-top: 12px;
}
.col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.subhead { display: none; padding: 0 4px; }
.empty { margin: 0; padding: 12px 4px; color: var(--fg-3); font-size: 13px; }
.error { margin: 16px 24px 0; padding: 10px 14px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); }
/* Two columns cannot share one header row with four titles, so each column names itself in the lane. */
@media (max-width: 1100px) {
  .board { --cols: repeat(2, minmax(0, 1fr)); padding-top: 16px; }
  .colhead { display: none; }
  .lane-head { top: 0; }
  .subhead { display: block; }
}
@media (max-width: 640px) {
  .board { --cols: minmax(0, 1fr); padding: 12px 16px 16px; }
  .col.none { display: none; }
}
</style>
