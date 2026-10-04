<script setup lang="ts">
import { computed, onMounted, type Component } from "vue";
import IconBook from "../icons/IconBook.vue";
import IconBranch from "../icons/IconBranch.vue";
import IconFolder from "../icons/IconFolder.vue";
import IconServer from "../icons/IconServer.vue";
import IconShield from "../icons/IconShield.vue";
import IconTerminal from "../icons/IconTerminal.vue";
import { reachable, recheck, status } from "../status/status";
import { sectionGroups, toolsDot, type SectionId } from "./nav";
import { loadError, loadSettings, repos } from "./store";

const icons: Record<SectionId, Component> = {
  general: IconFolder,
  repositories: IconBranch,
  agents: IconShield,
  playbooks: IconBook,
  tools: IconTerminal,
  daemon: IconServer,
};

const groups = sectionGroups();
const repoCount = computed(() => repos.value?.length);
const dot = computed(() => toolsDot(status.value, reachable.value));

onMounted(() => {
  // Spec §6.1: detect the CLIs on Settings open.
  void recheck().catch(() => undefined);
  void loadSettings();
});
</script>

<template>
  <main class="settings">
    <nav class="snav" aria-label="Settings">
      <template v-for="g in groups" :key="g.group">
        <div class="grp">{{ g.group }}</div>
        <RouterLink v-for="s in g.sections" :key="s.id" :to="`/settings/${s.id}`" active-class="on">
          <component :is="icons[s.id]" />{{ s.label }}
          <span v-if="s.id === 'repositories' && repoCount !== undefined" class="badge muted" style="margin-left: auto" :aria-label="`${repoCount} found`">{{ repoCount }}</span>
          <span v-if="s.id === 'tools'" class="dot" :class="dot" style="margin-left: auto" :aria-label="dot === 'ok' ? 'all tools ready' : dot === 'attn' ? 'a tool needs attention' : 'checking'"></span>
        </RouterLink>
      </template>
    </nav>
    <div class="content">
      <p v-if="loadError" class="alert" role="alert">Could not load settings: {{ loadError }}</p>
      <RouterView />
    </div>
  </main>
</template>
