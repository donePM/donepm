<script setup lang="ts">
import { useRouter } from "vue-router";
import { watchAskNotifications } from "../asks/notifications";
import IconArchive from "../icons/IconArchive.vue";
import IconBot from "../icons/IconBot.vue";
import IconColumns from "../icons/IconColumns.vue";
import IconSliders from "../icons/IconSliders.vue";
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
    <header class="top">
      <RouterLink to="/" class="brand"><span class="disc" aria-hidden="true"></span>donePM</RouterLink>
      <nav class="nav" aria-label="Main">
        <RouterLink to="/" exact-active-class="on"><IconColumns />Board</RouterLink>
        <RouterLink to="/agents" active-class="on">
          <IconBot />Agents<span v-if="status?.runningAgents" class="badge primary" :aria-label="`${status.runningAgents} running`">{{ status.runningAgents }}</span>
        </RouterLink>
        <RouterLink to="/archive" active-class="on"><IconArchive />Archive</RouterLink>
        <RouterLink to="/settings" active-class="on"><IconSliders />Settings</RouterLink>
      </nav>
      <div class="right">
        <StatusBar />
        <ThemeSwitch />
      </div>
    </header>
    <div class="view"><RouterView /></div>
  </div>
</template>

<style scoped>
/* The page never scrolls; each view scrolls inside `.view`, so the board can pin its own headers. */
.app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
/* Positioned, like every inner scroller, so visually hidden (.sr) labels stay inside the scroller
   instead of stretching the document. */
.view { position: relative; flex: 1; min-height: 0; overflow: auto; }
.top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 52px;
  padding: 0 20px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 15px; color: var(--fg); text-decoration: none; }
.brand:hover { color: var(--fg); }
.disc { position: relative; width: 18px; height: 18px; border-radius: 50%; background: var(--fg); }
.disc::after { content: ""; position: absolute; inset: 6px; border-radius: 50%; background: var(--card); }
.nav { display: flex; gap: 2px; flex-wrap: wrap; }
.nav a {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border-radius: 6px;
  color: var(--fg-2);
  text-decoration: none;
  font-weight: 500;
}
.nav a:hover, .nav a.on { background: var(--muted); color: var(--fg); }
.right { margin-left: auto; display: flex; align-items: center; gap: 10px; color: var(--fg-3); font-size: 13px; }
@media (max-width: 640px) {
  .top { padding: 8px 16px; gap: 8px 12px; }
  .nav a { padding: 0 8px; }
}
</style>
