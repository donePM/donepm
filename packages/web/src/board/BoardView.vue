<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { COLUMNS, groupByColumn } from "./columns";
import ItemCard from "./ItemCard.vue";
import { items, itemsError, itemsLoaded, watchItems } from "./items";

watchItems();

const repoRoot = ref<string>();
onMounted(() => api.settings().then((s) => (repoRoot.value = s.repoRoot), () => undefined));

const grouped = computed(() => groupByColumn(items.value));
</script>

<template>
  <p v-if="itemsError" class="error" role="alert">Could not load items: {{ itemsError }}</p>
  <main class="board">
    <section v-for="col in COLUMNS" :key="col.key" class="column" :aria-labelledby="`col-${col.key}`">
      <div class="head">
        <h2 :id="`col-${col.key}`" :class="{ amber: col.key === 'needs_you' }">{{ col.title }}</h2>
        <span class="count">{{ grouped[col.key].length }}</span>
      </div>
      <ItemCard v-for="item in grouped[col.key]" :key="item.id" :item="item" :repo-root="repoRoot" />
      <p v-if="itemsLoaded && col.key === 'ready' && !grouped.ready.length" class="empty">
        No open issues assigned to you.
      </p>
    </section>
  </main>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  padding: 20px 24px;
  align-items: start;
}
.column { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.head { display: flex; align-items: baseline; gap: 8px; padding: 0 4px 6px; }
h2 { margin: 0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-2); }
h2.amber { color: var(--amber); }
.count { font-size: 12px; color: var(--ink-3); }
.empty { margin: 0; padding: 0 4px; color: var(--ink-3); font-size: 13px; }
.error { margin: 16px 24px 0; padding: 10px 14px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); }
@media (max-width: 1100px) {
  .board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .board { grid-template-columns: minmax(0, 1fr); padding: 16px; }
}
</style>
