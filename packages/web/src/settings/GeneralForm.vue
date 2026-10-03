<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { api, ApiError } from "../api/client";
import type { Settings } from "../api/types";

const props = defineProps<{ settings: Settings }>();
const emit = defineEmits<{ saved: [settings: Settings] }>();

const form = reactive<Settings>({ ...props.settings });
watch(
  () => props.settings,
  (s) => Object.assign(form, s),
);

const saving = ref(false);
const message = ref<{ text: string; tone: "ok" | "error" }>();

const fields: { key: Exclude<keyof Settings, "sources" | "allowedWebFetchDomains">; label: string; type: "text" | "number"; min?: number }[] = [
  { key: "repoRoot", label: "Repository root", type: "text" },
  { key: "worktreeRoot", label: "Worktree root", type: "text" },
  { key: "branchPrefix", label: "Branch prefix", type: "text" },
  { key: "port", label: "Port", type: "number", min: 1 },
  { key: "pollIntervalSeconds", label: "Poll interval (s)", type: "number", min: 10 },
  { key: "maxConcurrentAgents", label: "Max agents at once", type: "number", min: 1 },
];

async function save() {
  saving.value = true;
  message.value = undefined;
  try {
    // Only this form's fields: the repositories and web access panels save theirs on their own.
    const patch = Object.fromEntries(fields.map((f) => [f.key, form[f.key]]));
    const { settings, restartRequired } = await api.saveSettings(patch);
    emit("saved", settings);
    message.value = { text: restartRequired ? "Saved. The new port applies after a restart." : "Saved.", tone: "ok" };
  } catch (e) {
    const issues = e instanceof ApiError ? (e.body as { issues?: { path: string; message: string }[] }).issues : undefined;
    const text = issues?.map((i) => `${i.path}: ${i.message}`).join("; ") ?? (e instanceof Error ? e.message : String(e));
    message.value = { text, tone: "error" };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="panel">
    <h2>General</h2>
    <form @submit.prevent="save">
      <div v-for="f in fields" :key="f.key" class="field">
        <label :for="`set-${f.key}`">{{ f.label }}</label>
        <input
          v-if="f.type === 'number'"
          :id="`set-${f.key}`"
          v-model.number="form[f.key]"
          type="number"
          :min="f.min"
          required
          class="mono"
        />
        <input v-else :id="`set-${f.key}`" v-model="form[f.key]" type="text" class="mono" spellcheck="false" />
      </div>
      <div class="actions">
        <p v-if="message" :class="message.tone" role="status">{{ message.text }}</p>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? "Saving…" : "Save" }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
form { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
label { font-weight: 500; color: var(--ink-2); }
input {
  height: 38px;
  border: 1px solid var(--border-control);
  border-radius: 6px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--ink);
  background: var(--card);
  width: 100%;
}
.actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--border-soft);
}
.actions p { margin: 0; font-size: 13px; }
.ok { color: var(--ink-2); }
.error { color: var(--danger); }
</style>
