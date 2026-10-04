<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { api, ApiError } from "../api/client";
import type { Settings } from "../api/types";
import { parseRetention, retentionInput } from "./retention";

const props = defineProps<{ settings: Settings }>();
const emit = defineEmits<{ saved: [settings: Settings] }>();

const form = reactive<Settings>({ ...props.settings });
/** Text, so an empty "delete after" can mean never (D37). */
const retention = reactive(retentionInput(props.settings));
watch(
  () => props.settings,
  (s) => {
    Object.assign(form, s);
    Object.assign(retention, retentionInput(s));
  },
);

const saving = ref(false);
const message = ref<{ text: string; tone: "ok" | "error" }>();

const fields: { key: Exclude<keyof Settings, "sources" | "allowedWebFetchDomains" | "removeWorktreeOnMerge" | "archiveAfterHours" | "deleteAfterDays">; label: string; type: "text" | "number"; min?: number }[] = [
  { key: "repoRoot", label: "Repository root", type: "text" },
  { key: "worktreeRoot", label: "Worktree root", type: "text" },
  { key: "branchPrefix", label: "Branch prefix", type: "text" },
  { key: "port", label: "Port", type: "number", min: 1 },
  { key: "pollIntervalSeconds", label: "Poll interval (s)", type: "number", min: 10 },
  { key: "maxConcurrentAgents", label: "Max agents at once", type: "number", min: 1 },
];

async function save() {
  message.value = undefined;
  const kept = parseRetention(retention);
  if (!kept.ok) {
    message.value = { text: kept.error, tone: "error" };
    return;
  }
  saving.value = true;
  try {
    // Only this form's fields: the repositories and web access panels save theirs on their own.
    const patch = {
      ...Object.fromEntries(fields.map((f) => [f.key, form[f.key]])),
      removeWorktreeOnMerge: form.removeWorktreeOnMerge,
      ...kept.value,
    };
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
      <fieldset class="group">
        <legend>Finished items</legend>
        <div class="field">
          <label for="set-archiveAfterHours">Archive after (hours)</label>
          <input id="set-archiveAfterHours" v-model="retention.archiveAfterHours" type="text" inputmode="numeric" required class="mono" aria-describedby="hint-archiveAfterHours" />
          <p id="hint-archiveAfterHours" class="hint">
            Finished items (done and PR merged, or done without a PR) leave the board after this many hours. They stay in the Archive with their agent run. 0 hides them immediately.
          </p>
        </div>
        <div class="field">
          <label for="set-deleteAfterDays">Delete after (days)</label>
          <input id="set-deleteAfterDays" v-model="retention.deleteAfterDays" type="text" inputmode="numeric" class="mono" aria-describedby="hint-deleteAfterDays" />
          <p id="hint-deleteAfterDays" class="hint">
            Archived items, their timeline and their agent transcript are deleted after this many days. Items that still have a worktree are kept until it is removed. Empty: never delete.
          </p>
        </div>
        <div class="field">
          <label class="check">
            <input v-model="form.removeWorktreeOnMerge" type="checkbox" aria-describedby="hint-removeWorktreeOnMerge" />
            Remove the worktree once its PR is merged
          </label>
          <p id="hint-removeWorktreeOnMerge" class="hint">
            When the PR is merged, remove the item's worktree on the next poll. Never removes a worktree with uncommitted changes.
          </p>
        </div>
        <p class="hint">Changes apply on the next poll.</p>
      </fieldset>
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
.check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.check input { width: auto; height: auto; }
.hint { margin: 0; font-size: 12px; color: var(--ink-3); }
.group { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 14px 0 0; border: none; border-top: 1px solid var(--border-soft); min-width: 0; }
legend { padding: 0 0 4px; font-weight: 600; color: var(--ink); }
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
