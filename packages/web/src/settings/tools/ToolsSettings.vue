<script setup lang="ts">
import { computed } from "vue";
import IconRefresh from "../../icons/IconRefresh.vue";
import { status } from "../../status/status";
import { useNow } from "../../time/now";
import { ago } from "../../time/relative";
import { settings } from "../store";
import ConnectionsPanel from "./ConnectionsPanel.vue";
import ToolsPanel from "./ToolsPanel.vue";

const now = useNow();
const poll = computed(() => status.value?.lastPoll);
const queries = computed(() => Object.values(settings.value?.sources ?? {}).filter((s) => s.managed && s.query).length);
const errors = computed(() => status.value?.pollErrors ?? []);
</script>

<template>
  <div>
    <h1>Tools</h1>
    <p class="lead">The command-line tools donePM collects work and sends drafts with, already logged in, and helpers agents may use. donePM never stores your tokens.</p>
  </div>

  <ToolsPanel title="Tools" :categories="['source', 'helper']" />

  <ConnectionsPanel />

  <section class="panel">
    <h2><IconRefresh />Polling</h2>
    <p class="sub">
      Collects the issues assigned to you<template v-if="queries"> and {{ queries }} repository {{ queries === 1 ? "query" : "queries" }}</template><template v-if="settings">, every {{ settings.pollIntervalSeconds }} s</template>.
      <template v-if="poll">
        Last poll {{ ago(poll.at, now) }}:
        <span v-if="poll.ok" class="ok-text">ok<template v-if="poll.issues !== undefined">, {{ poll.issues }} {{ poll.issues === 1 ? "issue" : "issues" }}</template></span>
        <span v-else class="danger-text">{{ poll.issues !== undefined ? "partly failed" : "failed" }}</span>.
      </template>
      <template v-else> No poll yet.</template>
    </p>
    <div class="sep"></div>
    <div style="font-weight: 500">Last errors</div>
    <ul v-if="errors.length" class="tl">
      <li v-for="e in errors" :key="e.at">
        <span class="dot danger"></span>
        <div class="w"><strong class="mono">{{ e.error }}</strong><span class="t">{{ ago(e.at, now) }} · {{ new Date(e.at).toLocaleString() }}</span></div>
      </li>
    </ul>
    <p v-else class="empty">No failed poll since the daemon started.</p>
  </section>
</template>
