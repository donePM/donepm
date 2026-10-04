<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api } from "../../api/client";
import { errorText } from "../../api/errors";
import type { DaemonInfo } from "../../api/types";
import IconRefresh from "../../icons/IconRefresh.vue";
import IconServer from "../../icons/IconServer.vue";
import { useNow } from "../../time/now";
import { bytes, uptime } from "../format";
import { saveErrorText, saveSettings, settings } from "../store";

const info = ref<DaemonInfo>();
const error = ref<string>();
const now = useNow();

async function load() {
  try {
    info.value = await api.daemon();
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(load);

const port = ref<number>();
watch(settings, (s) => (port.value = s?.port), { immediate: true });
const portMessage = ref<{ text: string; tone: "ok" | "error" }>();
const savingPort = ref(false);

async function savePort() {
  savingPort.value = true;
  portMessage.value = undefined;
  try {
    const { restartRequired } = await saveSettings({ port: port.value });
    portMessage.value = { text: restartRequired ? "Saved. The new port applies after a restart." : "Saved.", tone: "ok" };
  } catch (e) {
    portMessage.value = { text: saveErrorText(e), tone: "error" };
  } finally {
    savingPort.value = false;
  }
}

const action = ref<"restart" | "logs">();
const actionMessage = ref<{ text: string; tone: "ok" | "error" }>();

async function restart() {
  action.value = "restart";
  actionMessage.value = undefined;
  try {
    await api.restartDaemon();
    actionMessage.value = { text: "Restarting. The page reconnects on its own.", tone: "ok" };
  } catch (e) {
    actionMessage.value = { text: errorText(e), tone: "error" };
  } finally {
    action.value = undefined;
  }
}

async function openLogs() {
  action.value = "logs";
  actionMessage.value = undefined;
  try {
    await api.openDaemon("logs");
  } catch (e) {
    actionMessage.value = { text: errorText(e), tone: "error" };
  } finally {
    action.value = undefined;
  }
}
</script>

<template>
  <div>
    <h1>Daemon</h1>
    <p class="lead">The local process behind this page. It listens on 127.0.0.1 only.</p>
  </div>

  <section class="panel">
    <div class="row" style="justify-content: space-between">
      <h2><IconServer />donePM <span v-if="info" class="badge muted mono">{{ info.version }}</span></h2>
      <div class="row" style="gap: 8px">
        <button class="btn sm" type="button" :disabled="!info?.logFile || action !== undefined" :title="info && !info.logFile ? 'Started by hand: it logs to its terminal' : undefined" @click="openLogs">Open logs</button>
        <button class="btn sm" type="button" :disabled="info?.service !== 'launchd' || action !== undefined" :title="info?.service === 'manual' ? 'Started by hand: stop it and run donepm start again' : undefined" @click="restart">
          <IconRefresh class="ic-sm" />{{ action === "restart" ? "Restarting…" : "Restart" }}
        </button>
      </div>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="actionMessage" :class="actionMessage.tone === 'error' ? 'alert' : 'sub'" role="status">{{ actionMessage.text }}</p>
    <dl v-if="info" class="kv">
      <dt>Service</dt>
      <dd>
        <span v-if="info.service === 'launchd'" class="row" style="gap: 6px"><span class="dot ok"></span>runs under launchd, starts at login</span>
        <span v-else class="row" style="gap: 6px"><span class="dot off"></span>started by hand; <span class="mono">donepm install-service</span> keeps it running</span>
      </dd>
      <dt>Address</dt>
      <dd class="mono">127.0.0.1:{{ info.port }}</dd>
      <dt>Process</dt>
      <dd><span class="mono">pid {{ info.pid }}</span> · up {{ uptime(info.startedAt, now) }}</dd>
      <dt>Database</dt>
      <dd><span class="mono">{{ info.dbFile }}</span> · {{ bytes(info.dbBytes) }}</dd>
      <dt>Config</dt>
      <dd class="mono">{{ info.configFile }}</dd>
      <dt>Log</dt>
      <dd><span v-if="info.logFile" class="mono">{{ info.logFile }}</span><span v-else class="sub">the terminal it was started in</span></dd>
    </dl>
  </section>

  <form class="panel" @submit.prevent="savePort">
    <h2>Port</h2>
    <div class="field">
      <label for="set-port">Port</label>
      <input id="set-port" v-model.number="port" class="input mono" type="number" min="1" max="65535" required style="max-width: 120px" />
      <span class="help">The web UI and the CLI reach the daemon here. A new port applies after a restart.</span>
    </div>
    <div class="row">
      <button class="btn primary" type="submit" :disabled="savingPort || !settings">{{ savingPort ? "Saving…" : "Save" }}</button>
      <span v-if="portMessage" :class="portMessage.tone === 'error' ? 'danger-text' : 'sub'" role="status">{{ portMessage.text }}</span>
    </div>
  </form>
</template>
