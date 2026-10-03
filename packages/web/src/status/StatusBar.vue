<script setup lang="ts">
import { computed } from "vue";
import { useNow } from "../time/now";
import { ago } from "../time/relative";
import { health, problems, summary } from "./health";
import { reachable, status } from "./status";

const now = useNow();

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
    <RouterLink v-if="state === 'problem'" to="/settings" class="problem" :aria-label="label" :title="label">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path class="bang-line" d="M8 3.5v5.5" stroke-width="2" stroke-linecap="round" />
        <circle class="bang-dot" cx="8" cy="12" r="1.2" />
      </svg>
    </RouterLink>
    <span v-else-if="state === 'ok'" class="health"><span class="dot dot-good" aria-hidden="true"></span><span class="sr-only">All systems working</span></span>
    <span v-else class="health"><span class="dot dot-off" aria-hidden="true"></span><span class="sr-only">Checking…</span></span>
    <span :class="{ failed: poll.error }" :title="status?.lastPoll?.error">{{ poll.text }}</span>
  </div>
</template>

<style scoped>
.status { margin-left: auto; display: flex; align-items: center; gap: 12px; color: var(--ink-2); font-size: 13px; flex-wrap: wrap; }
.health { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; }
.problem { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; color: var(--danger); }
.problem:hover { color: var(--danger); background: var(--danger-tint); }
.problem:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.bang-line { fill: none; stroke: var(--card); }
.bang-dot { fill: var(--card); }
.failed { color: var(--danger); }
</style>
