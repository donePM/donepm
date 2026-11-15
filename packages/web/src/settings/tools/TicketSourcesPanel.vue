<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { api } from "../../api/client";
import type { TicketSourceSettings, TicketSourceTest } from "../../api/types";
import { repoName } from "../../board/lanes";
import IconTicket from "../../icons/IconTicket.vue";
import { repos, saveErrorText, saveSettings, settings } from "../store";
import { defaultQuery, entryProblem, jiraSearchUrl, queryLanguage, repoOrigins, ticketConnections, withoutTicketSource, withTicketSource } from "./ticket-sources";

/**
 * Jira and Azure Boards queries and the repositories their tickets are worked in (issues #139,
 * #142). A ticket of one repository goes there; of several, the user picks one on its card.
 */
const connections = computed(() => ticketConnections(settings.value));
const list = computed(() => settings.value?.ticketSources ?? []);
const origins = computed(() => repoOrigins(repos.value));
const connectionOf = (id: string) => connections.value.find((c) => c.id === id);
const kindOf = (id: string) => connectionOf(id)?.kind;
const baseUrlOf = (id: string) => {
  const c = connectionOf(id);
  return c?.kind === "jira" ? c.baseUrl : undefined;
};
const describe = (c: (typeof connections.value)[number]) => (c.kind === "jira" ? c.baseUrl : `Azure DevOps ${c.organization}`);
const isAzure = computed(() => kindOf(form.connection) === "azure-devops");

const busy = ref<string>();
const error = ref<string>();
const tests = reactive<Record<string, TicketSourceTest | { ok: false; error: string }>>({});

/** The entry being edited: its index, or "new". */
const editing = ref<number | "new">();
const form = reactive<TicketSourceSettings>({ connection: "", query: "", project: "", repos: [], assignOnStart: false });
const formProblem = computed(() => entryProblem(form));

function edit(index: number | "new") {
  const e = index === "new" ? undefined : list.value[index];
  Object.assign(form, {
    connection: e?.connection ?? connections.value[0]?.id ?? "",
    query: e?.query ?? "",
    project: e?.project ?? "",
    repos: [...(e?.repos ?? [])],
    assignOnStart: e?.assignOnStart ?? false,
  });
  editing.value = index;
  error.value = undefined;
}

async function save(key: string, ticketSources: TicketSourceSettings[]) {
  busy.value = key;
  error.value = undefined;
  try {
    await saveSettings({ ticketSources });
    return true;
  } catch (e) {
    error.value = saveErrorText(e);
    return false;
  } finally {
    busy.value = undefined;
  }
}

async function submit() {
  if (formProblem.value || editing.value === undefined) return;
  const index = editing.value === "new" ? undefined : editing.value;
  const entry = { ...form, repos: [...form.repos], ...(isAzure.value ? {} : { project: "" }) };
  if (await save("form", withTicketSource(list.value, entry, index))) editing.value = undefined;
}

const remove = (i: number) => save(`remove:${i}`, withoutTicketSource(list.value, i));

async function test(key: string, connection: string, query: string | undefined, project: string | undefined) {
  busy.value = `test:${key}`;
  try {
    const inProject = kindOf(connection) === "azure-devops" ? project?.trim() || undefined : undefined;
    tests[key] = await api.testTicketSource(connection, query?.trim() || undefined, inProject);
  } catch (e) {
    tests[key] = { ok: false, error: saveErrorText(e) };
  } finally {
    busy.value = undefined;
  }
}

function testText(t: TicketSourceTest | { ok: false; error: string }): string {
  if (!t.ok) return t.error;
  return `${t.count} ${t.count === 1 ? "ticket" : "tickets"}${t.count ? `: ${t.issues.slice(0, 3).map((i) => i.title).join(", ")}${t.count > 3 ? ", …" : ""}` : ""}`;
}
</script>

<template>
  <section v-if="connections.length" class="panel">
    <h2><IconTicket />Ticket sources</h2>
    <p class="sub">
      Jira and Azure Boards queries donePM collects tickets with, and the repositories their work goes to. A ticket of several repositories waits on the board until you
      choose one.
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div v-for="(e, i) in list" :key="i" class="status-row">
      <div class="w">
        <div class="h">
          <span class="mono">{{ e.query || defaultQuery(kindOf(e.connection), e.project) }}</span>
          <span class="badge muted mono">{{ e.connection }}</span>
          <span v-if="e.project" class="badge muted">{{ e.project }}</span>
          <span v-if="e.assignOnStart" class="badge muted">assign on start</span>
        </div>
        <div class="d mono">{{ e.repos.map(repoName).join(", ") }}</div>
        <div class="row" style="margin-top: 6px">
          <button class="btn sm" type="button" :disabled="busy !== undefined" @click="test(String(i), e.connection, e.query, e.project)">
            {{ busy === `test:${i}` ? "Testing…" : "Test" }}
          </button>
          <a v-if="baseUrlOf(e.connection)" class="btn sm" :href="jiraSearchUrl(baseUrlOf(e.connection)!, e.query)" target="_blank" rel="noreferrer">Open in Jira ↗</a>
          <button class="btn sm" type="button" :disabled="busy !== undefined" @click="edit(i)">Edit</button>
          <button class="btn sm" type="button" :disabled="busy !== undefined" @click="remove(i)">Remove</button>
          <span v-if="tests[String(i)]" class="help" :class="{ 'danger-text': !tests[String(i)]!.ok }">{{ testText(tests[String(i)]!) }}</span>
        </div>
      </div>
    </div>
    <p v-if="!list.length" class="empty">No ticket source yet.</p>
    <div class="sep"></div>
    <button v-if="editing === undefined" class="btn sm" type="button" @click="edit('new')">Add ticket source</button>
    <form v-else class="ts" @submit.prevent="submit">
      <label v-if="connections.length > 1" class="field">
        <span>Connection</span>
        <select v-model="form.connection" class="select">
          <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.id }} · {{ describe(c) }}</option>
        </select>
      </label>
      <label v-if="isAzure" class="field">
        <span>Project</span>
        <input v-model="form.project" class="input" type="text" placeholder="All projects of the organization" />
      </label>
      <label class="field">
        <span>{{ queryLanguage(kindOf(form.connection)) }}</span>
        <textarea v-model="form.query" class="input mono" rows="2" :placeholder="defaultQuery(kindOf(form.connection), form.project)"></textarea>
      </label>
      <fieldset class="field repos">
        <legend>Repositories</legend>
        <label v-for="o in origins" :key="o" class="check">
          <input v-model="form.repos" type="checkbox" :value="o" /> <span class="mono">{{ repoName(o) }}</span>
        </label>
        <span v-if="!origins.length" class="help">No local clone yet: clone a repository first (Settings › Repositories).</span>
      </fieldset>
      <label class="check">
        <input v-model="form.assignOnStart" type="checkbox" /> Assign the ticket to me in {{ isAzure ? "Azure Boards" : "Jira" }} when its agent starts
      </label>
      <div class="row">
        <button class="btn sm primary" type="submit" :disabled="busy !== undefined || !!formProblem" :title="formProblem">{{ busy === "form" ? "Saving…" : "Save" }}</button>
        <button class="btn sm" type="button" :disabled="busy !== undefined || !form.connection" @click="test('form', form.connection, form.query, form.project)">
          {{ busy === "test:form" ? "Testing…" : "Test" }}
        </button>
        <a v-if="baseUrlOf(form.connection)" class="btn sm" :href="jiraSearchUrl(baseUrlOf(form.connection)!, form.query)" target="_blank" rel="noreferrer">Open in Jira ↗</a>
        <button class="btn sm" type="button" @click="editing = undefined">Cancel</button>
      </div>
      <span v-if="tests.form" class="help" :class="{ 'danger-text': !tests.form.ok }">{{ testText(tests.form) }}</span>
    </form>
  </section>
</template>

<style scoped>
.ts { display: flex; flex-direction: column; gap: 8px; max-width: 560px; }
.repos { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.repos legend { padding: 0; margin-bottom: 4px; }
.check { display: flex; align-items: center; gap: 6px; }
a.btn { text-decoration: none; }
</style>
