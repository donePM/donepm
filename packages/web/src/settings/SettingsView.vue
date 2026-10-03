<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import type { Settings } from "../api/types";
import { recheck, status } from "../status/status";
import GeneralForm from "./GeneralForm.vue";
import OrphansPanel from "./OrphansPanel.vue";
import ReposPanel from "./ReposPanel.vue";
import SourcesPanel from "./SourcesPanel.vue";
import ToolsSummary from "./ToolsSummary.vue";
import WebAccessPanel from "./WebAccessPanel.vue";

const settings = ref<Settings>();
const error = ref<string>();

onMounted(async () => {
  // Spec §6.1: detect the CLIs on Settings open.
  void recheck().catch(() => undefined);
  try {
    settings.value = await api.settings();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <main class="settings">
    <p v-if="error" class="error" role="alert">Could not load settings: {{ error }}</p>
    <div class="main">
      <SourcesPanel :poll-seconds="settings?.pollIntervalSeconds" :queries="Object.values(settings?.sources ?? {}).filter((s) => s.query).length" />
      <ReposPanel :repo-root="settings?.repoRoot" :sources="settings?.sources" @saved="settings = $event" />
      <OrphansPanel :worktree-root="settings?.worktreeRoot" />
    </div>
    <div class="side">
      <GeneralForm v-if="settings" :settings="settings" @saved="settings = $event" />
      <WebAccessPanel v-if="settings" :domains="settings.allowedWebFetchDomains" @saved="settings = $event" />
      <section class="panel">
        <h2>Daemon</h2>
        <p class="sub mono">donepm {{ status?.version ?? "…" }}<template v-if="settings"> · :{{ settings.port }}</template></p>
        <ToolsSummary />
      </section>
    </div>
  </main>
</template>

<style scoped>
.settings {
  display: grid;
  grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
  gap: 24px;
  max-width: 1400px;
  margin: 0 auto;
  padding: 28px 24px;
  align-items: start;
}
.main, .side { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.error { grid-column: 1 / -1; margin: 0; padding: 10px 14px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); }
@media (max-width: 960px) {
  .settings { grid-template-columns: minmax(0, 1fr); padding: 16px; }
}
</style>
