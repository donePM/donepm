<script setup lang="ts">
import { computed, ref } from "vue";
import IconGlobe from "../../icons/IconGlobe.vue";
import { saveErrorText, saveSettings, settings } from "../store";
import { parseDomains } from "./domains";

const hosts = computed(() => settings.value?.allowedWebFetchDomains ?? []);
const adding = ref("");
const busy = ref(false);
const error = ref<string>();

async function store(next: string[]) {
  busy.value = true;
  error.value = undefined;
  try {
    await saveSettings({ allowedWebFetchDomains: next });
    return true;
  } catch (e) {
    error.value = saveErrorText(e);
    return false;
  } finally {
    busy.value = false;
  }
}

async function add() {
  const added = parseDomains(adding.value);
  if (!added.length) return;
  if (await store(parseDomains([...hosts.value, ...added].join("\n")))) adding.value = "";
}

const remove = (host: string) => store(hosts.value.filter((h) => h !== host));
</script>

<template>
  <section class="panel">
    <div class="row" style="justify-content: space-between">
      <h2><IconGlobe />Web access</h2>
      <span class="sub">Fetches to these hosts and their subdomains run without a question. Everything else asks.</span>
    </div>
    <div v-if="hosts.length" class="row" style="gap: 6px">
      <span v-for="h in hosts" :key="h" class="badge mono">
        {{ h }}
        <button class="btn ghost sm" type="button" style="height: 18px; padding: 0 2px" :disabled="busy" :aria-label="`Remove ${h}`" @click="remove(h)">×</button>
      </span>
    </div>
    <p v-else-if="settings" class="sub">No host yet: every page the agent wants to read asks first.</p>
    <form class="row" style="flex-wrap: nowrap; max-width: 420px" @submit.prevent="add">
      <label class="sr" for="set-host">Add host</label>
      <input id="set-host" v-model="adding" class="input mono" placeholder="docs.example.com" spellcheck="false" />
      <button class="btn sm" type="submit" :disabled="busy || !adding.trim()">Add</button>
    </form>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </section>
</template>
