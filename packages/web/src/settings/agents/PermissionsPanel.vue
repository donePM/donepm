<script setup lang="ts">
import { BLOCKED_COMMANDS, type PermissionGrant } from "@donepm/core";
import { computed, onMounted, ref } from "vue";
import { api } from "../../api/client";
import { errorText } from "../../api/errors";
import IconShield from "../../icons/IconShield.vue";
import { groupGrants } from "./grants";

const grants = ref<PermissionGrant[]>([]);
const loaded = ref(false);
const removing = ref<string>();
const error = ref<string>();

/** One row per rule, grouped by repository name. */
const rows = computed(() => groupGrants(grants.value).flatMap((g) => g.rows.map((r) => ({ ...r, scope: g.name }))));
/** What an agent may never run: the daemon does it after a draft is approved (rules of CLAUDE.md). */
const denied = [...BLOCKED_COMMANDS, "git push"];

const day = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });

async function load() {
  try {
    grants.value = await api.grants();
    loaded.value = true;
  } catch (e) {
    error.value = errorText(e);
  }
}

async function revoke(id: string) {
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
    <div class="row" style="justify-content: space-between">
      <h2><IconShield />Permissions</h2>
      <span class="sub">Always-allow rules you granted from a card. Revoke any time.</span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div v-if="rows.length" style="overflow-x: auto">
      <table class="tbl" style="min-width: 640px">
        <thead><tr><th>Rule</th><th>Scope</th><th>Granted</th><th>Used</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="mono" :title="`Granted for ${r.call}`">{{ r.raw }}</td>
            <td>{{ r.scope }}</td>
            <td :title="new Date(r.createdAt).toLocaleString()">{{ day(r.createdAt) }}</td>
            <td :title="r.lastUsedAt ? `Last used ${new Date(r.lastUsedAt).toLocaleString()}` : undefined">{{ r.useCount }}×</td>
            <td>
              <button class="btn sm ghost danger" type="button" :disabled="removing !== undefined" @click="revoke(r.id)">
                {{ removing === r.id ? "Revoking…" : "Revoke" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="loaded" class="empty">None yet. "Always allow in …" on a permission question adds one.</p>
    <div class="sep"></div>
    <div class="row" style="justify-content: space-between">
      <div>
        <div style="font-weight: 500">Always denied</div>
        <div class="sub">Fixed. The daemon runs these after your approval of a draft; an agent never does.</div>
      </div>
      <div class="row" style="gap: 4px">
        <span v-for="c in denied" :key="c" class="badge danger mono">{{ c }}</span>
      </div>
    </div>
  </section>
</template>
