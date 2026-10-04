<script setup lang="ts">
import ToolsPanel from "../tools/ToolsPanel.vue";
import PermissionsPanel from "./PermissionsPanel.vue";
import RunningAgentsPanel from "./RunningAgentsPanel.vue";
import WebAccessPanel from "./WebAccessPanel.vue";
</script>

<template>
  <div>
    <h1>Agents &amp; access</h1>
    <p class="lead">How many agents run, what they may do without asking, and what leaves the machine. Drafts always need your approval; nothing here changes that.</p>
  </div>
  <RunningAgentsPanel />
  <PermissionsPanel />
  <WebAccessPanel />
  <ToolsPanel />
</template>
