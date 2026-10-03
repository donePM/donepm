<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import type { Repo } from "../api/types";
import { status } from "../status/status";
import { useNow } from "../time/now";
import { ago } from "../time/relative";

defineProps<{ repoRoot?: string }>();

const repos = ref<Repo[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref<string>();
const now = useNow();

async function run(fn: () => Promise<Repo[]>) {
  busy.value = true;
  error.value = undefined;
  try {
    repos.value = await fn();
    loaded.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

onMounted(() => run(api.repos));
</script>

<template>
  <section class="panel">
    <div class="head">
      <div>
        <h2>Repositories</h2>
        <p class="sub">
          Found under <span class="mono">{{ repoRoot ?? "…" }}</span>, depth 4
          <template v-if="status?.lastScan"> · scanned {{ ago(status.lastScan, now) }}</template>
        </p>
      </div>
      <button class="btn" :disabled="busy" @click="run(api.rescan)">{{ busy ? "Scanning…" : "Rescan" }}</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="scroll">
      <table v-if="repos.length">
        <thead>
          <tr><th>Origin</th><th>Path</th><th>Base</th><th>Setup</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in repos" :key="r.id">
            <td class="mono">{{ r.originUrl }}</td>
            <td class="mono">{{ r.path }}</td>
            <td class="mono nowrap">{{ r.defaultBranch }}</td>
            <td :class="r.setup ? 'mono' : 'none'">{{ r.setup ? ".donepm/setup.yml" : "none" }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="loaded" class="sub">No git repositories with a GitHub origin found.</p>
    </div>
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.scroll { overflow-x: auto; margin-top: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-weight: 500; color: var(--ink-2); padding: 8px 12px; border-bottom: 1px solid var(--border); }
td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: top; overflow-wrap: anywhere; }
td.mono { font-size: 12px; }
td.none { color: var(--ink-3); }
td.nowrap { white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
.error { margin: 12px 0 0; color: var(--danger); }
</style>
