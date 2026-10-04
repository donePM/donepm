<script setup lang="ts">
import PathsPanel from "./PathsPanel.vue";
import RetentionPanel from "./RetentionPanel.vue";
</script>

<template>
  <div>
    <h1>General</h1>
    <p class="lead">Where donePM finds your clones, where agents work, and how long finished work stays around.</p>
  </div>
  <PathsPanel />
  <RetentionPanel />
</template>
