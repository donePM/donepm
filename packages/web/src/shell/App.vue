<script setup lang="ts">
import { useRouter } from "vue-router";
import { watchAskNotifications } from "../asks/notifications";
import { status, watchStatus } from "../status/status";
import StatusBar from "../status/StatusBar.vue";
import { watchTheme } from "../theme/apply";
import ThemeSwitch from "../theme/ThemeSwitch.vue";

watchTheme();
watchStatus();
watchAskNotifications(useRouter());
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand"><svg class="mark" viewBox="0 0 160 160" aria-hidden="true">
          <path fill="currentColor" fill-rule="evenodd" d="M80 0a80 80 0 1 1 0 160A80 80 0 0 1 80 0Zm0 64a16 16 0 1 0 0 32 16 16 0 0 0 0-32Z" />
        </svg>donePM</div>
      <nav>
        <RouterLink to="/" class="tab" exact-active-class="active">Board</RouterLink>
        <RouterLink to="/agents" class="tab" active-class="active">
          Agents<span v-if="status?.runningAgents" class="badge primary count" :aria-label="`${status.runningAgents} running`">{{ status.runningAgents }}</span>
        </RouterLink>
        <RouterLink to="/archive" class="tab" active-class="active">Archive</RouterLink>
        <RouterLink to="/settings" class="tab" active-class="active">Settings</RouterLink>
      </nav>
      <StatusBar />
      <ThemeSwitch />
    </header>
    <div class="view"><RouterView /></div>
  </div>
</template>

<style scoped>
/* The page never scrolls; each view scrolls inside `.view`, so the board can pin its own headers. */
.app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
.view { flex: 1; min-height: 0; overflow: auto; }
.topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 24px;
  min-height: 52px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
.mark { width: 18px; height: 18px; color: var(--fg); }
nav { display: flex; gap: 4px; }
.tab { padding: 6px 12px; border-radius: 6px; color: var(--fg-2); text-decoration: none; }
.tab:hover { color: var(--fg); background: var(--muted); }
.count { margin-left: 6px; }
.tab.active { background: var(--muted); color: var(--fg); font-weight: 500; }
@media (max-width: 640px) {
  .topbar { padding: 8px 16px; gap: 12px; }
}
</style>
