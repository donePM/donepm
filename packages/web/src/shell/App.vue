<script setup lang="ts">
import { status, watchStatus } from "../status/status";
import StatusBar from "../status/StatusBar.vue";

watchStatus();
</script>

<template>
  <header class="topbar">
    <div class="brand"><svg class="mark" viewBox="0 0 160 160" aria-hidden="true">
        <path fill="currentColor" fill-rule="evenodd" d="M80 0a80 80 0 1 1 0 160A80 80 0 0 1 80 0Zm0 64a16 16 0 1 0 0 32 16 16 0 0 0 0-32Z" />
      </svg>donePM</div>
    <nav>
      <RouterLink to="/" class="tab" exact-active-class="active">Board</RouterLink>
      <RouterLink to="/agents" class="tab" active-class="active">
        Agents<span v-if="status?.runningAgents" class="badge" :aria-label="`${status.runningAgents} running`">{{ status.runningAgents }}</span>
      </RouterLink>
      <RouterLink to="/settings" class="tab" active-class="active">Settings</RouterLink>
    </nav>
    <StatusBar />
  </header>
  <RouterView />
</template>

<style scoped>
.topbar {
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
.mark { width: 18px; height: 18px; color: var(--ink); }
nav { display: flex; gap: 4px; }
.tab { padding: 6px 12px; border-radius: 6px; color: var(--ink-2); text-decoration: none; }
.tab:hover { color: var(--ink); background: var(--border-soft); }
.badge {
  display: inline-block;
  min-width: 18px;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--blue);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.tab.active { background: var(--border-soft); color: var(--ink); font-weight: 500; }
@media (max-width: 640px) {
  .topbar { padding: 8px 16px; gap: 12px; }
}
</style>
