<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api/client";
import { errorText } from "../../api/errors";
import type { OrphanWorktree } from "../../api/types";
import IconAlert from "../../icons/IconAlert.vue";
import IconTrash from "../../icons/IconTrash.vue";
import { useNow } from "../../time/now";
import { ago } from "../../time/relative";
import { bytes } from "../format";
import { settings } from "../store";
import { orphanName } from "./repos";

const orphans = ref<OrphanWorktree[]>([]);
const removing = ref<string>();
const error = ref<string>();
const now = useNow(60_000);
const roots = computed(() => [settings.value?.worktreeRoot, ...(settings.value?.previousWorktreeRoots ?? [])].filter((r): r is string => !!r));

async function load() {
  try {
    orphans.value = await api.orphans();
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
watch(() => settings.value?.worktreeRoot, (next, before) => {
  if (before !== undefined && next !== before) void load();
});
</script>

<template>
  <section v-if="orphans.length || error" class="panel">
    <div class="row" style="justify-content: space-between">
      <h2><IconAlert />Worktrees without an item</h2>
      <span class="sub">under <template v-for="(r, i) in roots" :key="r"><template v-if="i"> or </template><span class="mono">{{ r }}</span></template></span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div v-for="o in orphans" :key="o.path" class="status-row warn">
      <div class="w">
        <div class="h"><span class="mono" style="font-size: 13px" :title="o.path">{{ orphanName(o.path, roots) }}</span><span v-if="o.sizeBytes !== undefined" class="badge muted">{{ bytes(o.sizeBytes) }}</span></div>
        <div class="d">
          <template v-if="o.branch">Branch <span class="mono">{{ o.branch }}</span> · </template><template v-if="o.lastCommitAt">last commit {{ ago(o.lastCommitAt, now) }} · </template>no item refers to it. Removing it keeps the branch.
        </div>
      </div>
      <button class="btn sm" type="button" :disabled="removing !== undefined" @click="remove(o.path)"><IconTrash class="ic-sm" />{{ removing === o.path ? "Removing…" : "Remove" }}</button>
    </div>
  </section>
</template>
