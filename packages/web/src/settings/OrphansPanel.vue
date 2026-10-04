<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { OrphanWorktree } from "../api/types";

const props = defineProps<{ worktreeRoot?: string; previousRoots?: string[] }>();

const orphans = ref<OrphanWorktree[]>([]);
const loaded = ref(false);
const removing = ref<string>();
const error = ref<string>();

async function load() {
  try {
    orphans.value = await api.orphans();
    loaded.value = true;
  } catch (e) {
    error.value = errorText(e);
  }
}

async function remove(path: string) {
  removing.value = path;
  error.value = undefined;
  try {
    await api.removeOrphan(path);
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    removing.value = undefined;
  }
}

onMounted(load);
// A new root (moved or left behind) changes what is orphaned (#93).
watch(() => props.worktreeRoot, (now, before) => {
  if (before !== undefined && now !== before) void load();
});
</script>

<template>
  <section class="panel">
    <h2>Orphaned worktrees</h2>
    <p class="sub">
      Worktrees under <span class="mono">{{ worktreeRoot ?? "…" }}</span><template v-for="r in previousRoots ?? []" :key="r">
        or the former root <span class="mono">{{ r }}</span></template> that belong to no item. Removing one keeps its branch.
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ul v-if="orphans.length" class="list">
      <li v-for="o in orphans" :key="o.path">
        <div class="what">
          <span class="mono path">{{ o.path }}</span>
          <span v-if="o.branch" class="mono branch">{{ o.branch }}</span>
        </div>
        <button class="btn danger" type="button" :disabled="removing !== undefined" @click="remove(o.path)">
          {{ removing === o.path ? "Removing…" : "Remove" }}
        </button>
      </li>
    </ul>
    <p v-else-if="loaded" class="sub none">None.</p>
  </section>
</template>

<style scoped>
.list { list-style: none; margin: 16px 0 0; padding: 0; }
li { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--border); }
li:last-child { border-bottom: 0; }
.what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.path { font-size: 12px; overflow-wrap: anywhere; }
.branch { font-size: 11px; color: var(--fg-3); }
.none { margin-top: 12px; }
.danger { flex: none; color: var(--danger); font-weight: 400; }
.error { margin: 12px 0 0; color: var(--danger); }
</style>
