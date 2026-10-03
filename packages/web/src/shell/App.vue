<script setup lang="ts">
import { watchStatus } from "../status/status";
import StatusBar from "../status/StatusBar.vue";

watchStatus();
</script>

<template>
  <header class="topbar">
    <div class="brand"><span class="mark" aria-hidden="true"></span>donePM</div>
    <nav>
      <RouterLink to="/" class="tab" exact-active-class="active">Board</RouterLink>
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
.mark { width: 10px; height: 10px; border-radius: 2px; background: var(--blue); }
nav { display: flex; gap: 4px; }
.tab { padding: 6px 12px; border-radius: 6px; color: var(--ink-2); text-decoration: none; }
.tab:hover { color: var(--ink); background: var(--border-soft); }
.tab.active { background: var(--border-soft); color: var(--ink); font-weight: 500; }
@media (max-width: 640px) {
  .topbar { padding: 8px 16px; gap: 12px; }
}
</style>
