<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api/client";
import { useAsks } from "../asks/live";
import { cardBadge } from "../board/card-badge";
import { items, itemsLoaded, watchItems } from "../board/items";
import type { ItemView } from "../api/types";
import IconStop from "../icons/IconStop.vue";
import { agentElapsed, clock, money, tokens } from "../time/duration";
import { useNow } from "../time/now";
import { since } from "../time/relative";
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

const groups = computed(() => agentGroups(items.value, now.value));
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
const rows = computed(() => toRows(messages.value, asks.value, { cwd: selected.value?.worktreePath }));

/** "owner/repo#12" → "repo #12". */
function shortId(externalId: string): string {
  const m = /^[^/]+\/([^#]+)#(\d+)$/.exec(externalId);
  return m ? `${m[1]} #${m[2]}` : externalId;
}

type Dot = "primary" | "attn" | "ok" | "danger" | "off";

/** The state line under an entry: its dot, colour and text. */
function stateLine(item: ItemView): { dot: Dot; pulse?: boolean; text: string } {
  const cost = item.agent.costUsd !== undefined ? money(item.agent.costUsd) : undefined;
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");
  if (item.state === "running") {
    const ms = agentElapsed(item.agent, now.value);
    return { dot: "primary", text: join("running", ms !== undefined ? clock(ms) : undefined, cost) };
  }
  if (item.state === "checking") {
    const checks = item.ci?.checks ?? [];
    const passed = checks.filter((c) => c.bucket === "pass").length;
    const what = checks.length ? `${passed} of ${checks.length} checks` : "waiting for CI";
    return { dot: "attn", pulse: true, text: join(what, since(item.stateSince, now.value)) };
  }
  const a = item.attention;
  if (a?.kind === "ask") return { dot: "attn", text: join("permission", a.toolName) };
  if (item.state === "failed" || a?.kind === "failed") return { dot: "danger", text: join("failed", cost) };
  if (item.state === "needs_you") {
    const badge = cardBadge(item);
    return { dot: badge?.tone === "danger" ? "danger" : "attn", text: join(badge?.text ?? "needs you", since(item.stateSince, now.value)) };
  }
  if (item.state === "done") return { dot: "ok", text: join(cardBadge(item)?.text ?? "done", cost) };
  return { dot: "off", text: join("stopped", cost) };
}

const STATE_TONE: Record<Dot, string> = { primary: "var(--primary)", attn: "var(--attn)", danger: "var(--danger)", ok: "var(--fg-3)", off: "var(--fg-3)" };

const header = computed(() => {
  const i = selected.value;
  if (!i) return "";
  const parts = [i.branch, i.playbook];
  const u = i.agent.usage;
  if (u) parts.push(`${tokens(u.inputTokens)} in / ${tokens(u.outputTokens)} out`);
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

// A note to the running agent; the daemon hands it to the turn in progress.
const note = ref("");
const sending = ref(false);
const sendError = ref<string>();
watch(selectedId, () => {
  note.value = "";
  sendError.value = undefined;
});
async function send() {
  const id = selectedId.value;
  const text = note.value.trim();
  if (!id || !text || sending.value) return;
  sending.value = true;
  sendError.value = undefined;
  try {
    await api.say(id, text);
    note.value = "";
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : String(e);
  } finally {
    sending.value = false;
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
            <span class="id mono">{{ shortId(item.externalId) }}</span>
            <span class="title">{{ item.title }}</span>
            <span class="state" :style="{ color: STATE_TONE[stateLine(item).dot] }">
              <span class="dot" :class="[stateLine(item).dot, { pulse: stateLine(item).pulse }]" aria-hidden="true"></span>{{ stateLine(item).text }}
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
          <span class="name">{{ shortId(selected.externalId) }} · {{ selected.title }}</span>
          <span class="sub mono">{{ header }}</span>
        </div>
        <div class="actions">
          <RouterLink :to="{ name: 'item', params: { id: selected.id } }" class="btn sm">Card</RouterLink>
          <RouterLink :to="{ name: 'item', params: { id: selected.id }, query: { tab: 'changes' } }" class="btn sm">Changes</RouterLink>
          <button
            v-if="selected.agent.running"
            class="btn sm danger"
            type="button"
            :disabled="pending.has(selected.id)"
            @click="stop(selected.id)"
          >
            <IconStop class="ic-sm" />Stop
          </button>
        </div>
      </div>
      <p v-if="stopError" class="alert error" role="alert">{{ stopError }}</p>
      <p v-if="error" class="alert error" role="alert">Could not load the transcript: {{ error }}</p>
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
      <form v-if="selected.agent.running" class="composer" @submit.prevent="send">
        <label class="sr" for="agent-note">Message to agent</label>
        <input
          id="agent-note"
          v-model="note"
          class="input"
          autocomplete="off"
          placeholder="Send a note to the agent · joins the running turn"
        />
        <button class="btn" type="submit" :disabled="sending || !note.trim()">Send</button>
      </form>
      <p v-if="sendError" class="alert error" role="alert">Could not send the note: {{ sendError }}</p>
    </section>
    <section v-else-if="selectedId && itemsLoaded" class="pane">
      <p class="empty pad">This item is gone.</p>
    </section>
  </main>
</template>

<style scoped>
/* Two panes, each its own scroll container; the view itself does not scroll on a desktop. */
.agents { display: flex; align-items: stretch; height: 100%; min-height: 0; }
.list {
  flex: 1 1 280px;
  max-width: 340px;
  min-width: 0;
  position: relative;
  overflow-y: auto;
  background: var(--card);
  border-right: 1px solid var(--border);
  padding-bottom: 16px;
}
h2 {
  margin: 0;
  padding: 14px 16px 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-3);
}
.entry {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 11px 16px;
  border-left: 3px solid transparent;
  color: var(--fg);
  text-decoration: none;
}
.entry:hover { background: var(--muted); color: var(--fg); }
.entry.active { background: var(--primary-tint); border-left-color: var(--primary); }
.entry .id { font-size: 12px; color: var(--fg-3); }
.entry .title { font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; }
.entry .state { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.g-finished { color: var(--fg-3); }
.g-finished .title { font-weight: 400; }
.pane { flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column; }
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.titles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.sub { font-size: 12px; color: var(--fg-3); overflow-wrap: anywhere; }
.actions { margin-left: auto; display: flex; gap: 6px; }
.actions .btn { text-decoration: none; }
.scroll { position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px; }
.composer { display: flex; gap: 8px; align-items: center; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--card); }
.composer .input { flex: 1; min-width: 0; }
.empty { margin: 0; padding: 0 16px; color: var(--fg-3); font-size: 13px; }
.empty.pad { padding: 20px; }
.scroll .empty { padding: 0; }
.pane > .alert { margin: 12px 20px 0; }
.pane > .alert:last-child { margin-bottom: 12px; }
/* On a phone the panes stack and the view scrolls as one page: a single scrollbar. */
@media (max-width: 800px) {
  .agents { flex-direction: column; height: auto; }
  .list { flex: none; max-width: none; overflow: visible; border-right: 0; border-bottom: 1px solid var(--border); }
  .pane { flex: none; }
  .scroll { overflow: visible; }
}
</style>
