<script setup lang="ts">
import { computed } from "vue";
import { items } from "../board/items";
import { useNow } from "../time/now";
import { ago } from "../time/relative";
import { health, problems, summary } from "./health";
import { needsYouCount, needsYouLabel } from "./needs-you";
import { reachable, status } from "./status";

const now = useNow();

const waiting = computed(() => needsYouCount(items.value));
const waitingLabel = computed(() => needsYouLabel(waiting.value));

const list = computed(() => problems(status.value, reachable.value));
const state = computed(() => health(status.value, reachable.value));
const label = computed(() => `${summary(list.value)}. Open Settings`);

const poll = computed(() => {
  const p = status.value?.lastPoll;
  if (!p) return { text: "not polled yet", error: false };
  return { text: p.ok ? `polled ${ago(p.at, now.value)}` : `poll failed ${ago(p.at, now.value)}`, error: !p.ok };
});
</script>

<template>
  <div class="status" aria-live="polite">
    <RouterLink v-if="waiting > 0" to="/" class="needs-you" :aria-label="waitingLabel" :title="waitingLabel">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M8 1.5 15 14H1z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <path class="tri-line" d="M8 6v4" stroke-width="1.6" stroke-linecap="round" />
        <circle class="tri-dot" cx="8" cy="12" r="0.9" />
      </svg>
      <span class="count">{{ waiting }}</span>
    </RouterLink>
    <RouterLink v-if="state === 'problem'" to="/settings" class="problem" :aria-label="label" :title="label">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path class="bang-line" d="M8 3.5v5.5" stroke-width="2" stroke-linecap="round" />
        <circle class="bang-dot" cx="8" cy="12" r="1.2" />
      </svg>
      <span class="sr">{{ label }}</span>
    </RouterLink>
    <span v-else-if="state === 'ok'" class="health"><span class="dot ok" aria-hidden="true"></span><span class="sr">All systems working</span></span>
    <span v-else class="health"><span class="dot off" aria-hidden="true"></span><span class="sr">Checking…</span></span>
    <span :class="{ failed: poll.error }" :title="status?.lastPoll?.error">{{ poll.text }}</span>
  </div>
</template>

<style scoped>
.status { margin-left: auto; display: flex; align-items: center; gap: 12px; color: var(--fg-2); font-size: 13px; flex-wrap: wrap; }
.health { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; }
.problem { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; color: var(--danger); }
.problem:hover { color: var(--danger); background: var(--danger-tint); }
.problem:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.bang-line { fill: none; stroke: var(--card); }
.bang-dot { fill: var(--card); }
.needs-you { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 6px; border-radius: 12px; color: var(--attn); font-weight: 600; text-decoration: none; }
.needs-you:hover, .needs-you:focus-visible { background: var(--attn-tint); }
.needs-you:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.tri-line { fill: none; stroke: var(--card); }
.tri-dot { fill: var(--card); }
.failed { color: var(--danger); }
</style>
