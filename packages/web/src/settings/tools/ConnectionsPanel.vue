<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { api } from "../../api/client";
import type { ConnectionConfig, ConnectionTest } from "../../api/types";
import IconGitHub from "../../icons/IconGitHub.vue";
import { status } from "../../status/status";
import { saveErrorText, saveSettings, settings } from "../store";
import ApiTokenField from "./ApiTokenField.vue";
import { configuredConnections, connectionRows, offeredHosts, restartPending, STATE_LABEL, withAzureDevOps, withGitHubHost, withJira, withoutConnection, type AzureDevOpsForm, type JiraForm } from "./connections";

const rows = computed(() => connectionRows(status.value, settings.value));
const offered = computed(() => offeredHosts(status.value, settings.value));
const pending = computed(() => restartPending(status.value, settings.value));

const busy = ref<string>();
const error = ref<string>();
const tests = reactive<Record<string, ConnectionTest | { error: string }>>({});

async function save(key: string, connections: ConnectionConfig[]) {
  busy.value = key;
  error.value = undefined;
  try {
    await saveSettings({ connections });
    return true;
  } catch (e) {
    error.value = saveErrorText(e);
    return false;
  } finally {
    busy.value = undefined;
  }
}

const enable = (host: string) => save(host, withGitHubHost(configuredConnections(settings.value), host));
const remove = (id: string) => save(`remove:${id}`, withoutConnection(configuredConnections(settings.value), id));

async function test(id: string) {
  busy.value = `test:${id}`;
  try {
    tests[id] = await api.testConnection(id);
  } catch (e) {
    tests[id] = { error: saveErrorText(e) };
  } finally {
    busy.value = undefined;
  }
}

const testOk = (t: ConnectionTest | { error: string }) => "ok" in t && t.ok;

function testText(t: ConnectionTest | { error: string }): string {
  if ("error" in t) return t.error;
  const said = [t.ok ? "works" : STATE_LABEL[t.state], t.deployment ? `Jira ${t.deployment === "cloud" ? "Cloud" : "Data Center"}` : undefined, t.detail];
  return said.filter(Boolean).join(" · ");
}

function tokenHint(c: ConnectionConfig): string | undefined {
  if (c.kind === "azure-devops") return `A personal access token of the ${c.organization} organization, with Code (read & write). Or from a terminal: donepm token set ${c.id}`;
  if (c.kind !== "jira") return undefined;
  const what = c.deployment === "cloud" ? `An Atlassian API token of ${c.email ?? "the account"}.` : "A personal access token from your Jira profile.";
  return `${what} Or from a terminal: donepm token set ${c.id}`;
}

const adding = ref<"jira" | "ado">();
const ado = reactive<AzureDevOpsForm>({ organization: "", backend: "cli" });

async function addAzureDevOps() {
  if (await save("ado", withAzureDevOps(configuredConnections(settings.value), ado))) {
    adding.value = undefined;
    Object.assign(ado, { organization: "", backend: "cli" });
  }
}
const jira = reactive<JiraForm>({ baseUrl: "https://", deployment: "cloud", email: "" });

async function addJira() {
  if (await save("jira", withJira(configuredConnections(settings.value), jira))) {
    adding.value = undefined;
    Object.assign(jira, { baseUrl: "https://", deployment: "cloud", email: "" });
  }
}
</script>

<template>
  <section class="panel">
    <h2><IconGitHub />Connections</h2>
    <p class="sub">The hosts donePM collects work from and sends drafts to. Tokens stay with gh or in the Keychain; donePM only shows whether one is set.</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div v-for="r in rows" :key="r.config.id" class="status-row">
      <span class="dot" :class="r.status?.state === 'ready' ? 'ok' : 'attn'" style="margin-top: 6px"></span>
      <div class="w">
        <div class="h">
          {{ r.host || r.config.id }} <span class="badge muted mono">{{ r.config.kind }} · {{ r.config.backend }}</span>
          <span v-if="r.status" class="badge" :class="r.status.state === 'ready' ? 'ok' : 'attn'">{{ STATE_LABEL[r.status.state] }}</span>
          <span v-else class="badge muted">applies after restart</span>
        </div>
        <div class="d mono">{{ [r.config.id, r.status?.detail].filter(Boolean).join(" · ") }}</div>
        <ApiTokenField v-if="r.config.backend === 'api'" :id="r.config.id" :token-set="r.status?.tokenSet" :hint="tokenHint(r.config)" />
        <div class="row" style="margin-top: 6px">
          <button class="btn sm" type="button" :disabled="busy !== undefined" @click="test(r.config.id)">{{ busy === `test:${r.config.id}` ? "Testing…" : "Test" }}</button>
          <button v-if="r.config.kind !== 'github'" class="btn sm" type="button" :disabled="busy !== undefined" @click="remove(r.config.id)">Remove</button>
          <span v-if="tests[r.config.id]" class="help" :class="{ 'danger-text': !testOk(tests[r.config.id]!) }">{{ testText(tests[r.config.id]!) }}</span>
        </div>
      </div>
    </div>
    <p v-if="pending" class="sub">Saved connections apply after a restart (Settings › Daemon).</p>
    <template v-if="offered.length">
      <div class="sep"></div>
      <div style="font-weight: 500">gh is also logged in to</div>
      <div v-for="host in offered" :key="host" class="row" style="justify-content: space-between; margin-top: 6px">
        <span class="mono">{{ host }}</span>
        <button class="btn sm" type="button" :disabled="busy !== undefined" @click="enable(host)">{{ busy === host ? "Adding…" : "Use this host" }}</button>
      </div>
    </template>
    <div class="sep"></div>
    <div v-if="!adding" class="row">
      <button class="btn sm" type="button" @click="adding = 'jira'">Add Jira</button>
      <button class="btn sm" type="button" @click="adding = 'ado'">Add Azure DevOps</button>
    </div>
    <form v-else-if="adding === 'ado'" class="jira" @submit.prevent="addAzureDevOps">
      <label class="field">
        <span>Organization</span>
        <input v-model="ado.organization" class="input mono" placeholder="acme, as in dev.azure.com/acme" required pattern="[A-Za-z0-9]([A-Za-z0-9\-]*[A-Za-z0-9])?" />
      </label>
      <label class="field">
        <span>Sign in through</span>
        <select v-model="ado.backend" class="select">
          <option value="cli">az (az login)</option>
          <option value="api">REST API (personal access token)</option>
        </select>
      </label>
      <span class="help">Test checks who az or the token signs in as.</span>
      <div class="row">
        <button class="btn sm primary" type="submit" :disabled="busy !== undefined">{{ busy === "ado" ? "Saving…" : "Save" }}</button>
        <button class="btn sm" type="button" @click="adding = undefined">Cancel</button>
      </div>
    </form>
    <form v-else class="jira" @submit.prevent="addJira">
      <label class="field">
        <span>Base URL</span>
        <input v-model="jira.baseUrl" class="input mono" type="url" placeholder="https://acme.atlassian.net" required />
      </label>
      <label class="field">
        <span>Deployment</span>
        <select v-model="jira.deployment" class="select">
          <option value="cloud">Jira Cloud (email + API token)</option>
          <option value="datacenter">Jira Data Center (personal access token)</option>
        </select>
      </label>
      <label v-if="jira.deployment === 'cloud'" class="field">
        <span>Account email</span>
        <input v-model="jira.email" class="input" type="email" placeholder="the account the API token belongs to" required />
      </label>
      <span class="help">Set the token once the connection is saved. Test checks the URL, the deployment and the token.</span>
      <div class="row">
        <button class="btn sm primary" type="submit" :disabled="busy !== undefined">{{ busy === "jira" ? "Saving…" : "Save" }}</button>
        <button class="btn sm" type="button" @click="adding = undefined">Cancel</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.jira { display: flex; flex-direction: column; gap: 8px; max-width: 420px; }
</style>
