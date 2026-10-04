<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { loadCollapsed, saveCollapsed, toggleCollapsed } from "./collapsed";
import { COLUMNS } from "./columns";
import ItemCard from "./ItemCard.vue";
import { items, itemsError, itemsLoaded, watchItems } from "./items";
import { buildLanes, dependabotCount, laneSummary, NO_CLONE_KEY, sortLanes, stableOrder, type Lane } from "./lanes";
import IconChevronDown from "../icons/IconChevronDown.vue";
import IconChevronRight from "../icons/IconChevronRight.vue";
import IconPackage from "../icons/IconPackage.vue";
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

/** Agents at work, In Progress header: "2 · 1 agent". */
const agents = computed(() => items.value.filter((i) => i.agent.running).length);
const headCount = (key: string) =>
  key === "in_progress" && agents.value ? `${totals.value[key]} · ${agents.value} ${agents.value === 1 ? "agent" : "agents"}` : String(totals.value[key]);
</script>

<template>
  <div class="page">
    <p v-if="itemsError" class="alert error" role="alert">Could not load items: {{ itemsError }}</p>
    <main class="board">
      <div class="cols">
        <div v-for="col in COLUMNS" :key="col.key" class="col-h" :class="{ attn: col.key === 'needs_you' }">
          <h2>{{ col.title }}</h2>
          <span class="n">{{ headCount(col.key) }}</span>
          <RouterLink v-if="col.key === 'done'" to="/archive" class="archive-link">Archive</RouterLink>
        </div>
      </div>
      <p v-if="itemsLoaded && !lanes.length" class="empty">
        Nothing to do in the repositories you manage. Choose them in <RouterLink to="/settings/repositories">Settings</RouterLink>.
      </p>
      <section v-for="lane in lanes" :key="lane.key" class="lane-sec" :class="{ shut: isCollapsed(lane) }" :aria-labelledby="`lane-${lane.key}`">
        <h3 class="lane-h">
          <button
            :id="`lane-${lane.key}`"
            class="lane"
            type="button"
            :aria-expanded="!isCollapsed(lane)"
            :aria-controls="`lane-body-${lane.key}`"
            @click="toggle(lane)"
          >
            <IconChevronRight v-if="isCollapsed(lane)" class="ic-sm chev" />
            <IconChevronDown v-else class="ic-sm chev" />
            <span class="name" :class="{ mono: lane.key !== NO_CLONE_KEY, muted: lane.key === NO_CLONE_KEY }">{{ lane.name }}</span>
            <span class="n" :class="{ attn: isCollapsed(lane) && lane.counts.needs_you > 0 }">{{ laneSummary(lane, isCollapsed(lane)) }}</span>
            <span v-if="isCollapsed(lane) && dependabotCount(lane)" class="badge muted">
              <IconPackage class="ic-sm" />{{ dependabotCount(lane) }} Dependabot {{ dependabotCount(lane) === 1 ? "PR" : "PRs" }}
            </span>
          </button>
        </h3>
        <div v-show="!isCollapsed(lane)" :id="`lane-body-${lane.key}`" class="lane-cols">
          <div
            v-for="col in COLUMNS"
            :key="col.key"
            class="stack"
            :class="{ none: !lane.columns[col.key].length }"
            role="group"
            :aria-label="col.title"
          >
            <h4 class="subhead" :class="{ attn: col.key === 'needs_you' }">{{ col.title }} <span class="n">{{ lane.counts[col.key] }}</span></h4>
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
/* The board is its own scroll container, both ways: below 1100px the four columns keep their
   width and scroll sideways, the headers stick on top. */
.board {
  --cols: repeat(4, minmax(232px, 1fr));
  --gap: 14px;
  --cols-h: 36px;
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 20px 24px;
}
.cols, .lane-cols { display: grid; grid-template-columns: var(--cols); gap: var(--gap); min-width: min-content; }
.cols {
  position: sticky;
  top: 0;
  z-index: 3;
  align-items: end;
  height: var(--cols-h);
  padding-top: 8px;
  box-sizing: border-box;
  background: var(--bg);
}
.col-h { display: flex; align-items: baseline; gap: 8px; padding: 0 4px 4px; min-width: 0; }
.col-h h2, .subhead { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-3); }
.col-h .n, .subhead .n { font-size: 12px; font-weight: 500; color: var(--fg-3); text-transform: none; letter-spacing: 0; }
.col-h.attn h2, .subhead.attn { color: var(--attn); }
.archive-link { margin-left: auto; font-size: 12px; color: var(--fg-3); text-decoration: none; }
.archive-link:hover { color: var(--primary); text-decoration: underline; }
.lane-sec { min-width: min-content; }
.lane-sec.shut + .lane-sec, .lane-sec + .lane-sec.shut { border-top: 1px solid var(--border); margin-top: 6px; }
.lane-h { position: sticky; top: var(--cols-h); z-index: 2; margin: 0; background: var(--bg); }
.lane {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-2);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.lane:hover { color: var(--fg); }
.lane:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.chev { color: var(--fg-3); }
.name { overflow-wrap: anywhere; }
.name.mono { font-size: 13px; }
.name.muted { color: var(--fg-3); }
.lane .n { font-weight: 400; color: var(--fg-3); }
.lane .n.attn { color: var(--attn); font-weight: 500; }
.lane .badge { font-weight: 500; }
.lane-cols { align-items: start; padding: 4px 0 8px; }
.stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.subhead { display: none; padding: 0 4px; }
.empty { margin: 0; padding: 12px 4px; color: var(--fg-3); font-size: 13px; }
.error { margin: 16px 20px 0; }
/* A phone gets one column; each column names itself in the lane. */
@media (max-width: 640px) {
  .board { --cols: minmax(0, 1fr); padding: 0 16px 16px; }
  .cols { display: none; }
  .lane-h { top: 0; }
  .subhead { display: block; }
  .stack.none { display: none; }
}
</style>
