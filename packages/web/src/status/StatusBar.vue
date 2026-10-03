<script setup lang="ts">
import { computed } from "vue";
import { useNow } from "../time/now";
import { ago } from "../time/relative";
import { status } from "./status";

const now = useNow();

const gh = computed(() => {
  const s = status.value?.gh;
  if (!s) return { text: "gh …", tone: "off" };
  if (s.state === "ready") return { text: "gh ready", tone: "ok" };
  return { text: s.state === "not_installed" ? "gh missing" : "gh not logged in", tone: "warn" };
});

const claude = computed(() => {
  const s = status.value?.claude;
  if (!s) return { text: "claude …", tone: "off" };
  if (s.state === "ready") return { text: `claude ${s.version?.split(".").slice(0, 2).join(".") ?? ""}`.trim(), tone: "ok" };
  return { text: s.state === "not_installed" ? "claude missing" : "claude not logged in", tone: "warn" };
});

const poll = computed(() => {
  const p = status.value?.lastPoll;
  if (!p) return { text: "not polled yet", error: false };
  return { text: p.ok ? `polled ${ago(p.at, now.value)}` : `poll failed ${ago(p.at, now.value)}`, error: !p.ok };
});
</script>

<template>
  <div class="status" aria-live="polite">
    <RouterLink to="/settings" class="cli"><span class="dot" :class="`dot-${gh.tone}`"></span>{{ gh.text }}</RouterLink>
    <RouterLink to="/settings" class="cli"><span class="dot" :class="`dot-${claude.tone}`"></span>{{ claude.text }}</RouterLink>
    <span :class="{ failed: poll.error }" :title="status?.lastPoll?.error">{{ poll.text }}</span>
  </div>
</template>

<style scoped>
.status { margin-left: auto; display: flex; align-items: center; gap: 16px; color: var(--ink-2); font-size: 13px; flex-wrap: wrap; }
.cli { display: flex; align-items: center; gap: 6px; color: inherit; text-decoration: none; }
.cli:hover { color: var(--ink); }
.failed { color: var(--danger); }
</style>
