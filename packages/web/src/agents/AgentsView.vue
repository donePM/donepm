<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAsks } from "../asks/live";
import { displayId } from "../board/columns";
import { items, itemsLoaded, watchItems } from "../board/items";
import type { ItemView } from "../api/types";
import { agentElapsed, clock, money } from "../time/duration";
import { useNow } from "../time/now";
import { useTranscript } from "../transcript/live";
import { toRows } from "../transcript/rows";
import { repoOf } from "../markdown/render";
import TranscriptRows from "../transcript/TranscriptRows.vue";
import { pending, stopAgent } from "./actions";
import { AGENT_GROUPS, agentGroups } from "./groups";

watchItems();

const route = useRoute();
const router = useRouter();
const now = useNow(1000);

const groups = computed(() => agentGroups(items.value));
const listed = computed(() => AGENT_GROUPS.flatMap((g) => groups.value[g.key]));
const selectedId = computed(() => (typeof route.params.id === "string" ? route.params.id : undefined));
const selected = computed(() => items.value.find((i) => i.id === selectedId.value));

// Without a selection, open the first agent in the list.
watch(
  [selectedId, listed],
  ([id, list]) => {
    if (!id && list[0]) void router.replace({ name: "agent", params: { id: list[0].id } });
  },
  { immediate: true },
);

const { messages, live, error } = useTranscript(selectedId);
const asks = useAsks(selectedId);
const rows = computed(() => toRows(messages.value, asks.value));

/** The agent waits on a permission question (spec 9.4). */
const asking = (item: ItemView) => item.attention?.kind === "ask";

function status(item: ItemView): string {
  const parts: string[] = [];
  if (item.state === "running") {
    parts.push("running");
    const ms = agentElapsed(item.agent, now.value);
    if (ms !== undefined) parts.push(clock(ms));
  } else if (asking(item)) parts.push("asks permission");
  else if (item.state === "needs_you") parts.push(item.agent.running ? "waiting for you" : "needs you");
  else parts.push(item.state);
  if (item.agent.costUsd !== undefined) parts.push(money(item.agent.costUsd));
  return parts.join(" · ");
}

const header = computed(() => {
  const i = selected.value;
  if (!i) return "";
  const parts = [i.branch, i.playbook];
  if (i.agentSessionId) parts.push(`session ${i.agentSessionId.slice(0, 4)}…`);
  return parts.filter(Boolean).join(" · ");
});

const stopError = ref<string>();
async function stop(id: string) {
  stopError.value = undefined;
  try {
    await stopAgent(id);
  } catch (e) {
    stopError.value = e instanceof Error ? e.message : String(e);
  }
}

// Follow the transcript while the user is at the bottom.
const scroller = ref<HTMLElement>();
watch([() => rows.value.length, live], async () => {
  const el = scroller.value;
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  await nextTick();
  if (atBottom) el.scrollTop = el.scrollHeight;
}, { flush: "pre" });
</script>

<template>
  <main class="agents">
    <aside class="list" aria-label="Agents">
      <template v-for="g in AGENT_GROUPS" :key="g.key">
        <template v-if="groups[g.key].length">
          <h2>{{ g.title }}</h2>
          <RouterLink
            v-for="item in groups[g.key]"
            :key="item.id"
            :to="{ name: 'agent', params: { id: item.id } }"
            class="entry"
            :class="[`g-${g.key}`, { active: item.id === selectedId }]"
          >
            <span class="id mono">{{ displayId(item.externalId) }}</span>
            <span class="title">{{ item.title }}</span>
            <span class="state" :class="{ asking: asking(item) }">
              <span v-if="g.key === 'running'" class="dot dot-ok" aria-hidden="true"></span>{{ status(item) }}
            </span>
          </RouterLink>
        </template>
      </template>
      <p v-if="itemsLoaded && !listed.length" class="empty">
        No agents yet. Start one from a card in Ready on the <RouterLink to="/">board</RouterLink>.
      </p>
    </aside>

    <section v-if="selected" class="pane">
      <div class="head">
        <div class="titles">
          <span class="name">{{ displayId(selected.externalId) }} · {{ selected.title }}</span>
          <span class="sub mono">{{ header }}</span>
        </div>
        <div class="actions">
          <RouterLink to="/" class="btn">Board</RouterLink>
          <button
            v-if="selected.agent.running"
            class="btn stop"
            type="button"
            :disabled="pending.has(selected.id)"
            @click="stop(selected.id)"
          >
            Stop
          </button>
        </div>
      </div>
      <p v-if="stopError" class="error" role="alert">{{ stopError }}</p>
      <p v-if="error" class="error" role="alert">Could not load the transcript: {{ error }}</p>
      <div ref="scroller" class="scroll">
        <TranscriptRows
          :rows="rows"
          :live="live"
          :now="now"
          :running="selected.agent.running"
          :repo="repoOf(selected.externalId)"
          :worktree="selected.worktreePath"
        />
        <p v-if="!rows.length && !live" class="empty">Nothing yet.</p>
      </div>
    </section>
    <section v-else-if="selectedId && itemsLoaded" class="pane">
      <p class="empty pad">This item is gone.</p>
    </section>
  </main>
</template>

<style scoped>
.agents { display: flex; align-items: stretch; height: 100%; min-height: 0; }
.list {
  flex: 0 0 320px;
  min-width: 0;
  overflow-y: auto;
  background: var(--card);
  border-right: 1px solid var(--border);
  padding-bottom: 16px;
}
h2 {
  margin: 0;
  padding: 16px 16px 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-2);
}
.entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border-left: 3px solid transparent;
  color: var(--ink);
  text-decoration: none;
}
.entry:hover { background: var(--border-soft); color: var(--ink); }
.entry.active { background: var(--blue-tint); border-left-color: var(--blue); }
.entry .id { font-size: 12px; color: var(--ink-2); }
.entry .title { font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; }
.entry .state { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-3); }
.g-running .state { color: var(--blue); }
.g-waiting .state { color: var(--amber); }
.entry .state.asking { color: var(--amber); font-weight: 600; }
.g-finished { color: var(--ink-2); }
.g-finished .title { font-weight: 400; }
.pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.sub { font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.actions { margin-left: auto; display: flex; gap: 8px; }
.actions .btn { display: inline-flex; align-items: center; text-decoration: none; font-weight: 400; }
.stop { color: var(--danger); }
.scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 20px; }
.empty { margin: 0; padding: 0 16px; color: var(--ink-3); font-size: 13px; }
.empty.pad { padding: 20px; }
.scroll .empty { padding: 0; }
.error { margin: 12px 20px 0; padding: 10px 14px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); }
@media (max-width: 800px) {
  .agents { flex-direction: column; height: auto; }
  .list { flex: none; max-height: 40vh; border-right: 0; border-bottom: 1px solid var(--border); }
  .scroll { overflow: visible; }
}
</style>
