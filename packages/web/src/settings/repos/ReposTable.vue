<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../../api/client";
import { errorText } from "../../api/errors";
import type { PlaybookList, RepoView } from "../../api/types";
import IconRefresh from "../../icons/IconRefresh.vue";
import { status } from "../../status/status";
import { repos, settings } from "../store";
import RepoEditor from "./RepoEditor.vue";
import { pollLine, slug, visibleRepos } from "./repos";

const filter = ref("");
const showIgnored = ref(false);
const editing = ref<string>();
const busy = ref(false);
const error = ref<string>();
const playbooks = ref<PlaybookList>();

onMounted(() => {
  api.playbooks().then((p) => (playbooks.value = p), () => undefined);
});

const ignoredCount = computed(() => repos.value?.filter((r) => !r.managed).length ?? 0);
const rows = computed(() => visibleRepos(repos.value ?? [], filter.value, showIgnored.value));

// With nothing managed yet, every clone is ignored: show them, so there is something to choose from (D46).
let decided = false;
watch(
  repos,
  (list) => {
    if (!list || decided) return;
    decided = true;
    if (!list.some((r) => r.managed)) showIgnored.value = true;
  },
  { immediate: true },
);

async function rescan() {
  busy.value = true;
  error.value = undefined;
  try {
    repos.value = await api.rescan();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

const source = (r: RepoView) => settings.value?.sources[r.originUrl];
const poll = (r: RepoView) => pollLine(status.value?.lastPoll?.sources?.[r.originUrl]);
</script>

<template>
  <section class="card">
    <div class="row" style="padding: 12px 14px; border-bottom: 1px solid var(--border)">
      <label class="sr" for="repo-filter">Filter repositories</label>
      <input id="repo-filter" v-model="filter" class="input" placeholder="Filter…" style="max-width: 260px" />
      <label class="check" style="font-size: 13px; color: var(--fg-2)"><input v-model="showIgnored" type="checkbox" /> Show ignored ({{ ignoredCount }})</label>
      <button class="btn sm" type="button" style="margin-left: auto" :disabled="busy" @click="rescan"><IconRefresh class="ic-sm" />{{ busy ? "Scanning…" : "Rescan" }}</button>
    </div>
    <p v-if="error" class="alert" role="alert" style="margin: 12px 14px">{{ error }}</p>
    <div v-if="rows.length" style="overflow-x: auto">
      <table class="tbl" style="min-width: 760px">
        <thead><tr><th>Repository</th><th>Base</th><th>Source query</th><th>Options</th><th>Worktrees</th><th><span class="sr">Edit</span></th></tr></thead>
        <tbody>
          <template v-for="r in rows" :key="r.id">
            <tr :class="{ off: !r.managed }">
              <td><div style="font-weight: 500">{{ slug(r.originUrl) }}</div><div class="mono" :style="r.managed ? 'color: var(--fg-3)' : undefined">{{ r.path }}</div></td>
              <td class="mono">{{ r.defaultBranch }}</td>
              <td v-if="!r.managed">—</td>
              <td v-else>
                <span v-if="source(r)?.query" class="mono">{{ source(r)!.query }}</span>
                <span v-else class="sub">assigned to you</span>
                <div v-if="poll(r)" class="sub" :class="{ 'danger-text': poll(r)!.failed }">{{ poll(r)!.text }}</div>
              </td>
              <td>
                <span v-if="!r.managed" class="badge muted">ignored</span>
                <div v-else-if="source(r)?.assignOnStart || source(r)?.autoMerge || source(r)?.playbook || r.setup" class="row" style="gap: 4px">
                  <span v-if="source(r)?.assignOnStart" class="badge">assigns on start</span>
                  <span v-if="source(r)?.playbook" class="badge mono">{{ source(r)!.playbook }}</span>
                  <span v-if="source(r)?.autoMerge" class="badge">merges automatically</span>
                  <span v-if="r.setup" class="badge ok">setup.yml</span>
                </div>
                <span v-else class="sub">—</span>
              </td>
              <td>{{ r.worktrees }}</td>
              <td>
                <button class="btn sm ghost" type="button" :aria-expanded="editing === r.id" @click="editing = editing === r.id ? undefined : r.id">Edit</button>
              </td>
            </tr>
            <tr v-if="editing === r.id" style="background: var(--muted)">
              <td colspan="6" style="padding: 16px 14px">
                <RepoEditor :repo="r" :playbooks="playbooks" @close="editing = undefined" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-else-if="repos && !repos.length" class="empty" style="margin: 14px">No git repositories with a GitHub origin found. Clone one below, or change the repository root under General.</p>
    <p v-else-if="repos" class="empty" style="margin: 14px">No repository matches.</p>
  </section>
</template>
