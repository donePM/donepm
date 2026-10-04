<script setup lang="ts">
import { MERGE_METHODS, type MergeMethod } from "@donepm/core";
import { computed, reactive, ref } from "vue";
import { api } from "../../api/client";
import { errorText } from "../../api/errors";
import type { PlaybookList, RepoView, SourceTest } from "../../api/types";
import { repos, saveErrorText, saveSettings, settings } from "../store";
import { playbookChoices } from "./repos";
import { DEFAULT_QUERY, issueSearchUrl, withSource } from "./sources";

const props = defineProps<{ repo: RepoView; playbooks?: PlaybookList }>();
const emit = defineEmits<{ close: [] }>();

const source = settings.value?.sources[props.repo.originUrl];
const form = reactive({
  query: source?.query ?? "",
  assignOnStart: source?.assignOnStart ?? false,
  autoMerge: source?.autoMerge ?? false,
  mergeMethod: (source?.mergeMethod ?? "squash") as MergeMethod,
  playbook: source?.playbook ?? "",
  ignored: !props.repo.managed,
});

const choices = computed(() => {
  const list = playbookChoices(props.playbooks, props.repo.originUrl);
  // A configured playbook that no longer exists stays selectable, so saving does not drop it unseen.
  return form.playbook && !list.some((c) => c.name === form.playbook) ? [...list, { name: form.playbook, label: `${form.playbook} (not found)` }] : list;
});

const testing = ref(false);
const test = ref<SourceTest>();
const saving = ref(false);
const error = ref<string>();
const id = (name: string) => `${name}-${props.repo.id}`;

async function runTest() {
  testing.value = true;
  error.value = undefined;
  test.value = undefined;
  try {
    test.value = await api.testSource(props.repo.originUrl, form.query.trim() || DEFAULT_QUERY);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    testing.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = undefined;
  try {
    const { ignored, ...rest } = form;
    await saveSettings({ sources: withSource(settings.value?.sources ?? {}, props.repo.originUrl, { ...rest, managed: !ignored }) });
    repos.value = await api.repos();
    emit("close");
  } catch (e) {
    error.value = saveErrorText(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="editor" @submit.prevent="save">
    <div class="col">
      <div class="field">
        <label :for="id('query')">GitHub search query</label>
        <div class="row" style="flex-wrap: nowrap">
          <input :id="id('query')" v-model="form.query" class="input mono" spellcheck="false" :placeholder="DEFAULT_QUERY" />
          <button class="btn sm" type="button" :disabled="testing" @click="runTest">{{ testing ? "Testing…" : "Test" }}</button>
          <a class="btn sm ghost" :href="issueSearchUrl(repo.originUrl, form.query)" target="_blank" rel="noopener">Open in GitHub</a>
        </div>
        <span class="help">
          Leave empty for <span class="mono">{{ DEFAULT_QUERY }}</span>. Only this repository's open issues are searched.<template v-if="test">
            Test: <span class="ok-text">{{ test.count }} {{ test.count === 1 ? "issue matches" : "issues match" }}</span>.</template>
        </span>
        <ul v-if="test?.issues.length" class="found">
          <li v-for="i in test.issues" :key="i.number"><span class="mono">#{{ i.number }}</span> {{ i.title }}</li>
        </ul>
      </div>
      <div class="field">
        <label :for="id('playbook')">Default playbook</label>
        <select :id="id('playbook')" v-model="form.playbook" class="select" style="max-width: 320px">
          <option value="">Chosen by the issue's labels</option>
          <option v-for="c in choices" :key="c.name" :value="c.name">{{ c.label }}</option>
        </select>
        <span class="help">New issues of this repository start with it.</span>
      </div>
    </div>
    <div class="col">
      <label class="switch"><input v-model="form.assignOnStart" type="checkbox" /><span>Assign the issue to me when an agent starts</span></label>
      <label class="switch"><input v-model="form.ignored" type="checkbox" /><span>Ignore this repository</span></label>
      <label class="switch"><input v-model="form.autoMerge" type="checkbox" /><span>Merge others' pull requests on their own once I approved them and their checks passed</span></label>
      <div class="field">
        <label :for="id('merge')">Merge method for others' pull requests</label>
        <select :id="id('merge')" v-model="form.mergeMethod" class="select" style="max-width: 200px">
          <option v-for="m in MERGE_METHODS" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
      <div class="row" style="gap: 8px; margin-top: 4px">
        <button class="btn sm primary" type="submit" :disabled="saving">{{ saving ? "Saving…" : "Save" }}</button>
        <button class="btn sm ghost" type="button" @click="emit('close')">Cancel</button>
      </div>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
    </div>
  </form>
</template>

<style scoped>
.editor { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.col { display: flex; flex-direction: column; gap: 12px; }
.found { margin: 0; padding-left: 18px; font-size: 12px; color: var(--fg-2); }
@media (max-width: 720px) {
  .editor { grid-template-columns: minmax(0, 1fr); }
}
</style>
