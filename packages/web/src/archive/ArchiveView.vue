<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { ItemView } from "../api/types";
import { displayId } from "../board/columns";
import { onPush } from "../live/socket";
import { ago } from "../time/relative";
import { useNow } from "../time/now";
import { filterArchive } from "./filter";

/** Finished items the retention job took off the board (D37). Opening one shows the normal detail page. */
const archived = ref<ItemView[]>([]);
const loaded = ref(false);
const error = ref<string>();
const query = ref("");
const now = useNow(60_000);

async function load() {
  try {
    archived.value = await api.archive();
    error.value = undefined;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);
// An item that leaves the board may have just been archived.
onScopeDispose(
  onPush((msg) => {
    if (msg.type === "item.removed") void load();
  }),
);

const shown = computed(() => filterArchive(archived.value, query.value));
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>Archive</h1>
      <label for="archive-search" class="sr">Search the archive</label>
      <input id="archive-search" v-model="query" type="search" placeholder="Search by title or issue" class="search" />
    </header>
    <p v-if="error" class="error" role="alert">Could not load the archive: {{ error }}</p>
    <p v-else-if="loaded && !archived.length" class="empty">Nothing archived yet. Finished items move here after the time set in Settings.</p>
    <p v-else-if="loaded && !shown.length" class="empty">No archived item matches.</p>
    <ul v-else class="list">
      <li v-for="item in shown" :key="item.id" class="row">
        <span class="id mono">{{ displayId(item.externalId) }}</span>
        <RouterLink :to="{ name: 'item', params: { id: item.id } }" class="title">{{ item.title }}</RouterLink>
        <a v-if="item.pr" :href="item.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ item.pr.number }}</a>
        <span v-if="item.archivedAt" class="when" :title="item.archivedAt">archived {{ ago(item.archivedAt, now) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page { max-width: 960px; margin: 0 auto; padding: 24px; }
.head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
h1 { margin: 0; font-size: 18px; font-weight: 600; }
.search {
  flex: 1;
  min-width: 200px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--card);
  color: var(--fg);
  font: inherit;
  font-size: 13px;
}
.list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--muted); }
.row { display: flex; align-items: baseline; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--border); flex-wrap: wrap; }
.row:first-child { border-top: none; }
.id { flex: none; font-size: 12px; color: var(--fg-3); }
.title { flex: 1; min-width: 0; color: var(--fg-2); text-decoration: none; overflow-wrap: anywhere; }
.title:hover { color: var(--primary); text-decoration: underline; }
.pr { font-size: 12px; color: var(--fg-3); text-decoration: none; }
.pr:hover { color: var(--primary); text-decoration: underline; }
.when { font-size: 12px; color: var(--fg-3); }
.empty { margin: 0; padding: 12px 4px; color: var(--fg-3); font-size: 13px; }
.error { margin: 0 0 12px; padding: 10px 14px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); }
@media (max-width: 640px) {
  .page { padding: 16px; }
}
</style>
