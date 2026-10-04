<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import type { RepoView, Settings, SourceTest } from "../api/types";
import { status } from "../status/status";
import { useNow } from "../time/now";
import { ago } from "../time/relative";
import { DEFAULT_QUERY, issueSearchUrl, withSource } from "./sources";

const props = defineProps<{ repoRoot?: string; sources?: Settings["sources"] }>();
const emit = defineEmits<{ saved: [settings: Settings] }>();

const repos = ref<RepoView[]>([]);
const ignoredCount = computed(() => repos.value.filter((r) => r.ignored).length);
const loaded = ref(false);
const busy = ref(false);
const error = ref<string>();
const now = useNow();

async function run(fn: () => Promise<RepoView[]>) {
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

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `owner/repo` of a `host/owner/repo` origin. */
const slug = (origin: string) => origin.split("/").slice(1).join("/");

/** Ignoring only hides: the daemon stops polling the repository and keeps what it has. */
async function toggleIgnored(r: RepoView, box: HTMLInputElement) {
  error.value = undefined;
  try {
    const out = await api.setIgnored(r.id, box.checked);
    repos.value = out.repos;
    emit("saved", out.settings);
  } catch (e) {
    box.checked = r.ignored;
    error.value = message(e);
  }
}

/** The repository whose source is being edited, with the form's state. */
const editing = ref<{
  origin: string;
  query: string;
  assignOnStart: boolean;
  testing: boolean;
  test?: SourceTest;
  saving: boolean;
  error?: string;
}>();

function edit(origin: string) {
  const s = props.sources?.[origin];
  editing.value = { origin, query: s?.query ?? "", assignOnStart: s?.assignOnStart ?? false, testing: false, saving: false };
}

async function test() {
  const e = editing.value!;
  e.testing = true;
  e.error = undefined;
  e.test = undefined;
  try {
    e.test = await api.testSource(e.origin, e.query.trim() || DEFAULT_QUERY);
  } catch (err) {
    e.error = message(err);
  } finally {
    e.testing = false;
  }
}

async function save() {
  const e = editing.value!;
  e.saving = true;
  e.error = undefined;
  try {
    const sources = withSource(props.sources ?? {}, e.origin, e);
    const { settings } = await api.saveSettings({ sources });
    emit("saved", settings);
    editing.value = undefined;
  } catch (err) {
    e.error = message(err);
  } finally {
    e.saving = false;
  }
}

const pollOf = (origin: string) => status.value?.lastPoll?.sources?.[origin];
</script>

<template>
  <section class="panel">
    <div class="head">
      <div>
        <h2>Repositories</h2>
        <p class="sub">
          Found under <span class="mono">{{ repoRoot ?? "…" }}</span>, depth 4
          <template v-if="status?.lastScan"> · scanned {{ ago(status.lastScan, now) }}</template>
          <template v-if="ignoredCount"> · <span class="ignored-count">{{ ignoredCount }} ignored</span></template>
        </p>
      </div>
      <button class="btn" :disabled="busy" @click="run(api.rescan)">{{ busy ? "Scanning…" : "Rescan" }}</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="scroll">
      <table v-if="repos.length">
        <thead>
          <tr><th>Origin</th><th>Path</th><th>Base</th><th>Setup</th><th>Collects</th><th>Ignore</th></tr>
        </thead>
        <tbody>
          <template v-for="r in repos" :key="r.id">
            <tr :class="{ ignored: r.ignored }">
              <td class="mono">
                {{ r.originUrl }}
                <span v-if="r.ignored" class="tag">Ignored</span>
              </td>
              <td class="mono">{{ r.path }}</td>
              <td class="mono nowrap">{{ r.defaultBranch }}</td>
              <td :class="r.setup ? 'mono' : 'none'">{{ r.setup ? ".donepm/setup.yml" : "none" }}</td>
              <td>
                <!-- Flex inside the cell: a td with display: flex leaves the table and loses the row height (#90). -->
                <div class="collects">
                  <span v-if="sources?.[r.originUrl]?.query" class="mono">{{ sources[r.originUrl]!.query }}</span>
                  <span v-else class="none">assigned to you</span>
                  <span v-if="sources?.[r.originUrl]?.assignOnStart" class="tag">assigns on start</span>
                  <span v-if="pollOf(r.originUrl)?.ok === false" class="failed" :title="pollOf(r.originUrl)!.error">query failed</span>
                  <button v-if="editing?.origin !== r.originUrl" class="link" @click="edit(r.originUrl)">Edit</button>
                </div>
              </td>
              <td class="toggle">
                <input
                  type="checkbox"
                  :checked="r.ignored"
                  :aria-label="`Ignore ${slug(r.originUrl)}`"
                  :title="r.ignored ? 'Show its items on the board again' : 'Keep its items off the board'"
                  @change="toggleIgnored(r, $event.target as HTMLInputElement)"
                />
              </td>
            </tr>
            <tr v-if="editing?.origin === r.originUrl" class="editor">
              <td colspan="6">
                <form @submit.prevent="save">
                  <label :for="`query-${r.id}`">GitHub issue search</label>
                  <p class="sub">
                    Build the filter on GitHub, then paste it here. Empty collects the issues assigned to you.
                    donePM only ever searches this repository, and only open issues.
                  </p>
                  <div class="row">
                    <input
                      :id="`query-${r.id}`"
                      v-model="editing.query"
                      type="text"
                      class="mono"
                      spellcheck="false"
                      :placeholder="DEFAULT_QUERY"
                    />
                    <button type="button" class="btn" :disabled="editing.testing" @click="test">
                      {{ editing.testing ? "Testing…" : "Test" }}
                    </button>
                    <a class="btn" :href="issueSearchUrl(r.originUrl, editing.query)" target="_blank" rel="noopener">Open in GitHub</a>
                  </div>
                  <div v-if="editing.test" class="result">
                    <p>{{ editing.test.count }} open {{ editing.test.count === 1 ? "issue" : "issues" }}</p>
                    <ul>
                      <li v-for="i in editing.test.issues" :key="i.number">
                        <span class="mono">#{{ i.number }}</span> {{ i.title }}
                      </li>
                    </ul>
                  </div>
                  <label class="check">
                    <input v-model="editing.assignOnStart" type="checkbox" />
                    Assign the issue to me on GitHub when I start it
                  </label>
                  <div class="actions">
                    <p v-if="editing.error" class="error" role="alert">{{ editing.error }}</p>
                    <button type="button" class="btn" @click="editing = undefined">Cancel</button>
                    <button type="submit" class="btn btn-primary" :disabled="editing.saving">{{ editing.saving ? "Saving…" : "Save" }}</button>
                  </div>
                </form>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-else-if="loaded" class="sub">No git repositories with a GitHub origin found.</p>
    </div>
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.scroll { overflow-x: auto; margin-top: 16px; }
table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-weight: 500; color: var(--ink-2); padding: 8px 12px; border-bottom: 1px solid var(--border); }
td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: top; overflow-wrap: anywhere; }
td.mono { font-size: 12px; }
td.none, .none { color: var(--ink-3); }
td.nowrap { white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
.collects { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.collects .mono { font-size: 12px; }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--border-soft); color: var(--ink-2); white-space: nowrap; }
tr.ignored td:not(.toggle) { color: var(--ink-3); }
tr.ignored .collects .mono { color: inherit; }
.ignored-count { font-weight: 500; }
.toggle { text-align: center; }
.failed { color: var(--danger); white-space: nowrap; }
.link { border: 0; background: none; padding: 0; color: var(--ink-2); text-decoration: underline; cursor: pointer; font: inherit; }
.editor td { background: var(--card); }
form { display: flex; flex-direction: column; gap: 10px; }
form label { font-weight: 500; color: var(--ink-2); }
form .sub { margin: 0; }
.row { display: flex; gap: 8px; }
.row input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: 1px solid var(--border-control);
  border-radius: 6px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--ink);
  background: var(--card);
}
.row .btn { white-space: nowrap; text-decoration: none; }
.result p { margin: 0 0 4px; font-weight: 500; }
.result ul { margin: 0; padding-left: 18px; color: var(--ink-2); }
.check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.actions .error { margin: 0 auto 0 0; }
.error { margin: 12px 0 0; color: var(--danger); }
</style>
