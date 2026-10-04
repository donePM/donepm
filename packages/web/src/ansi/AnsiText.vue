<script setup lang="ts">
import { computed } from "vue";
import { ansiSegments } from "./ansi";

const props = defineProps<{ text: string }>();
const segments = computed(() => ansiSegments(props.text));
</script>

<template>
  <!-- Text nodes only: Vue escapes them, there is no v-html. -->
  <span v-for="(s, i) in segments" :key="i" :class="s.classes" :style="s.style">{{ s.text }}</span>
</template>
