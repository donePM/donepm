<script setup lang="ts">
// Pending yellow, as GitHub shows a check that has not finished. The text next to it names the state.
</script>

<template>
  <span class="ci-pending-dot" aria-hidden="true"></span>
</template>

<style scoped>
.ci-pending-dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--pending);
  animation: ci-pending-pulse 1.6s ease-in-out infinite;
}
/* Opacity and transform only: the dot keeps its box, so the text beside it never moves. */
@keyframes ci-pending-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.8); }
}
@media (prefers-reduced-motion: reduce) {
  .ci-pending-dot { animation: none; }
}
</style>
