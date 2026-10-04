<script setup lang="ts">
import { computed } from "vue";
import { items } from "../board/items";
import IconAlert from "../icons/IconAlert.vue";
import { useNow } from "../time/now";
import { ago } from "../time/relative";
import { health, problems, summary } from "./health";
import { needsYouCount, needsYouLabel, needsYouShort } from "./needs-you";
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
    <RouterLink v-if="waiting > 0" to="/" class="pill pill-attn" :aria-label="waitingLabel" :title="waitingLabel">
      <IconAlert class="ic-sm" />{{ needsYouShort(waiting) }}
    </RouterLink>
    <span class="health">
      <RouterLink v-if="state === 'problem'" to="/settings/tools" class="problem" :aria-label="label" :title="label">
        <IconAlert class="ic-sm" />
      </RouterLink>
      <span v-else-if="state === 'ok'" class="dot ok" title="All systems working"><span class="sr">All systems working</span></span>
      <span v-else class="dot off"><span class="sr">Checking…</span></span>
      <span :class="{ failed: poll.error }" :title="status?.lastPoll?.error">{{ poll.text }}</span>
    </span>
  </div>
</template>

<style scoped>
.status { display: flex; align-items: center; gap: 10px; color: var(--fg-3); font-size: 13px; flex-wrap: wrap; }
.pill { text-decoration: none; }
.pill:hover { color: var(--attn); filter: brightness(0.97); }
.health { display: inline-flex; align-items: center; gap: 6px; }
.problem { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; color: var(--danger); }
.problem:hover { color: var(--danger); background: var(--danger-tint); }
.failed { color: var(--danger); }
</style>
