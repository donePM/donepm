<script setup lang="ts">
import type { DiffLine } from "./rows";

defineProps<{ lines: DiffLine[] }>();
</script>

<template>
  <pre class="diff"><span v-for="(l, i) in lines" :key="i" :class="{ add: l.op === '+', del: l.op === '-' }">{{ l.op }} {{ l.text }}</span></pre>
</template>

<style scoped>
.diff { margin: 0; padding: 8px 0; max-height: 360px; overflow: auto; line-height: 1.6; white-space: pre; font-family: var(--mono); font-size: 12px; }
.diff span { display: block; padding: 0 12px; }
.add { background: var(--add); }
.del { background: var(--danger-tint); }
</style>
