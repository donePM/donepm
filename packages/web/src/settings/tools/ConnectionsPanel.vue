<script setup lang="ts">
import { computed, ref } from "vue";
import IconGitHub from "../../icons/IconGitHub.vue";
import { status } from "../../status/status";
import { saveErrorText, saveSettings, settings } from "../store";
import { configuredConnections, offeredHosts, restartPending, STATE_LABEL, withGitHubHost } from "./connections";

const rows = computed(() => status.value?.connections ?? []);
const offered = computed(() => offeredHosts(status.value, settings.value));
const pending = computed(() => restartPending(status.value, settings.value));

const busy = ref<string>();
const error = ref<string>();

async function enable(host: string) {
  busy.value = host;
  error.value = undefined;
  try {
    await saveSettings({ connections: withGitHubHost(configuredConnections(settings.value), host) });
  } catch (e) {
    error.value = saveErrorText(e);
  } finally {
    busy.value = undefined;
  }
}
</script>

<template>
  <section class="panel">
    <h2><IconGitHub />Connections</h2>
    <p class="sub">The hosts donePM collects work from and sends drafts to. Tokens stay with gh or in the Keychain; donePM only shows whether one is set.</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div v-for="c in rows" :key="c.id" class="status-row">
      <span class="dot" :class="c.state === 'ready' ? 'ok' : 'attn'" style="margin-top: 6px"></span>
      <div class="w">
        <div class="h">
          {{ c.host ?? c.id }} <span class="badge muted mono">{{ c.kind }} · {{ c.backend }}</span>
          <span class="badge" :class="c.state === 'ready' ? 'ok' : 'attn'">{{ STATE_LABEL[c.state] }}</span>
        </div>
        <div class="d mono">{{ [c.id, c.detail].filter(Boolean).join(" · ") }}</div>
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
  </section>
</template>
