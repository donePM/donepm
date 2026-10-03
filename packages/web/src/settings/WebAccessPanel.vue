<script setup lang="ts">
import { ref, watch } from "vue";
import { api, ApiError } from "../api/client";
import type { Settings } from "../api/types";
import { formatDomains, parseDomains } from "./domains";

const props = defineProps<{ domains: string[] }>();
const emit = defineEmits<{ saved: [settings: Settings] }>();

const text = ref(formatDomains(props.domains));
watch(
  () => props.domains,
  (d) => (text.value = formatDomains(d)),
);

const saving = ref(false);
const message = ref<{ text: string; tone: "ok" | "error" }>();

async function save() {
  saving.value = true;
  message.value = undefined;
  try {
    const { settings } = await api.saveSettings({ allowedWebFetchDomains: parseDomains(text.value) });
    emit("saved", settings);
    message.value = { text: "Saved. Applies to the next question.", tone: "ok" };
  } catch (e) {
    const issues = e instanceof ApiError ? (e.body as { issues?: { path: string; message: string }[] }).issues : undefined;
    const text = issues?.map((i) => i.message).join("; ") ?? (e instanceof Error ? e.message : String(e));
    message.value = { text, tone: "error" };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="panel">
    <h2>Web access</h2>
    <p class="sub">
      The agent reads pages on these hosts and their subdomains without asking you (WebFetch only, no credentials).
      Commands that connect to the network still ask. One host per line; empty asks for every page.
    </p>
    <form @submit.prevent="save">
      <label class="sr-only" for="set-web-domains">Hosts the agent may read without asking</label>
      <textarea id="set-web-domains" v-model="text" class="mono" rows="6" spellcheck="false"></textarea>
      <div class="actions">
        <p v-if="message" :class="message.tone" role="status">{{ message.text }}</p>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? "Saving…" : "Save" }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.sub { margin: 4px 0 0; }
form { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
textarea {
  border: 1px solid var(--border-control);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--ink);
  background: var(--card);
  width: 100%;
  resize: vertical;
}
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.actions p { margin: 0; font-size: 13px; }
.ok { color: var(--ink-2); }
.error { color: var(--danger); }
</style>
