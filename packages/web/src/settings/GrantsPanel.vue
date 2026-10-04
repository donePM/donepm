<script setup lang="ts">
import type { PermissionGrant } from "@donepm/core";
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import { ago } from "../time/relative";
import { useNow } from "../time/now";
import { groupGrants, usesText } from "./grants";

const grants = ref<PermissionGrant[]>([]);
const loaded = ref(false);
const removing = ref<string>();
const error = ref<string>();
const now = useNow(60_000);

const groups = computed(() => groupGrants(grants.value));

async function load() {
  try {
    grants.value = await api.grants();
    loaded.value = true;
  } catch (e) {
    error.value = errorText(e);
  }
}

async function remove(id: string) {
  removing.value = id;
  error.value = undefined;
  try {
    await api.revokeGrant(id);
    grants.value = grants.value.filter((g) => g.id !== id);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    removing.value = undefined;
  }
}

onMounted(load);
</script>

<template>
  <section class="panel">
    <h2>Always allowed</h2>
    <p class="sub">
      Rules you allowed for every run in a repository. donePM answers matching asks itself; removing a rule applies at once,
      also to agents already running.
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-for="g in groups" :key="g.repo" class="group">
      <h3 class="mono">{{ g.name }}</h3>
      <ul class="list">
        <li v-for="r in g.rows" :key="r.id">
          <div class="what">
            <span>{{ r.words.text }}<template v-if="r.words.pattern"> <code class="mono">{{ r.words.pattern }}</code></template></span>
            <span class="mono raw">{{ r.raw }}</span>
            <span class="meta">
              granted {{ ago(r.createdAt, now) }} · {{ usesText(r.useCount) }}<template v-if="r.lastUsedAt">, last {{ ago(r.lastUsedAt, now) }}</template>
            </span>
            <span v-if="r.call" class="meta">for <span class="mono">{{ r.call }}</span></span>
          </div>
          <button class="btn danger" type="button" :disabled="removing !== undefined" @click="remove(r.id)">
            {{ removing === r.id ? "Removing…" : "Remove" }}
          </button>
        </li>
      </ul>
    </div>
    <p v-if="loaded && !groups.length" class="sub none">None. "Always allow in …" on a permission ask adds one.</p>
  </section>
</template>

<style scoped>
.group { margin-top: 16px; }
h3 { margin: 0 0 4px; font-size: 12px; font-weight: 600; color: var(--fg-2); }
.list { list-style: none; margin: 0; padding: 0; }
li { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--border); }
li:last-child { border-bottom: 0; }
.what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
code { padding: 0 4px; border-radius: 4px; background: var(--muted); border: 1px solid var(--border); overflow-wrap: anywhere; }
.raw { font-size: 11px; color: var(--fg-3); overflow-wrap: anywhere; }
.meta { font-size: 12px; color: var(--fg-3); overflow-wrap: anywhere; }
.none { margin-top: 12px; }
.danger { flex: none; color: var(--danger); font-weight: 400; }
.error { margin: 12px 0 0; color: var(--danger); }
</style>
