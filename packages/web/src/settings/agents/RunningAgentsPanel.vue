<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { notifyEnabled, notifyPermission, requestNotifyPermission, setNotifyEnabled } from "../../asks/notifications";
import IconBot from "../../icons/IconBot.vue";
import { useNow } from "../../time/now";
import { ago } from "../../time/relative";
import { saveErrorText, saveSettings, settings } from "../store";

const form = reactive({ maxConcurrentAgents: 1, pollIntervalSeconds: 60, removeWorktreeOnMerge: false });
watch(
  settings,
  (s) => {
    if (s) Object.assign(form, { maxConcurrentAgents: s.maxConcurrentAgents, pollIntervalSeconds: s.pollIntervalSeconds, removeWorktreeOnMerge: s.removeWorktreeOnMerge });
  },
  { immediate: true },
);

const saving = ref(false);
const savedAt = ref<string>();
const error = ref<string>();
const now = useNow();

async function save() {
  saving.value = true;
  error.value = undefined;
  try {
    await saveSettings({ ...form });
    savedAt.value = new Date().toISOString();
  } catch (e) {
    error.value = saveErrorText(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="panel" @submit.prevent="save">
    <h2><IconBot />Running agents</h2>
    <div class="pair">
      <div class="field">
        <label for="set-max">Agents at once</label>
        <input id="set-max" v-model.number="form.maxConcurrentAgents" class="input" type="number" min="1" required style="max-width: 120px" />
        <span class="help">More than one shares your Claude rate limit. Each needs a worktree and a slot.</span>
      </div>
      <div class="field">
        <label for="set-poll">Poll interval</label>
        <div class="row" style="flex-wrap: nowrap">
          <input id="set-poll" v-model.number="form.pollIntervalSeconds" class="input" type="number" min="10" required style="max-width: 120px" /><span class="sub">seconds</span>
        </div>
        <span class="help">GitHub issues, PR state, CI checks and conflicts are read on this schedule.</span>
      </div>
    </div>
    <div class="sep"></div>
    <label class="switch">
      <input v-model="form.removeWorktreeOnMerge" type="checkbox" />
      <span>Remove a worktree on its own once the PR is merged and nothing uncommitted is left</span>
    </label>
    <div class="notify">
      <label class="switch">
        <input type="checkbox" :checked="notifyEnabled" @change="setNotifyEnabled(($event.target as HTMLInputElement).checked)" />
        <span>Browser notification and tab badge when an agent needs you</span>
      </label>
      <span class="sub">Belongs to this browser and applies at once.
        <template v-if="notifyPermission === 'unsupported'">This browser has no notifications.</template>
        <template v-else-if="notifyPermission === 'denied'">The browser blocks notifications for this site; allow them in its site settings.</template>
      </span>
      <button v-if="notifyEnabled && notifyPermission === 'default'" class="btn sm" type="button" @click="requestNotifyPermission()">Allow browser notifications</button>
    </div>
    <div class="row">
      <button class="btn primary" type="submit" :disabled="saving || !settings">{{ saving ? "Saving…" : "Save" }}</button>
      <span v-if="error" class="danger-text" role="alert">{{ error }}</span>
      <span v-else-if="savedAt" class="sub" role="status">Saved {{ ago(savedAt, now) }}</span>
    </div>
  </form>
</template>

<style scoped>
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.notify { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.notify .sub { padding-left: 44px; }
@media (max-width: 640px) {
  .pair { grid-template-columns: minmax(0, 1fr); }
}
</style>
