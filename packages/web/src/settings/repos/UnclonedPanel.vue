<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { api } from "../../api/client";
import { errorText } from "../../api/errors";
import IconBranch from "../../icons/IconBranch.vue";
import { onPush } from "../../live/socket";
import { status } from "../../status/status";
import { loadSettings, repos, saveErrorText, saveSettings, settings } from "../store";

/** Origins whose "Clone and manage" was clicked here: where the clone goes, or why it failed. */
const cloning = ref<Record<string, { path?: string; error?: string }>>({});
const error = ref<string>();

// A clone that finishes shows up in the table; one that fails says why in its row.
const stopPushes = onPush((msg) => {
  if (msg.type !== "repo.cloned" && msg.type !== "repo.clone_failed") return;
  const { origin, error: failed } = msg.payload as { origin: string; error?: string };
  if (!(origin in cloning.value)) return;
  if (failed) cloning.value[origin] = { error: failed };
  else {
    delete cloning.value[origin];
    void loadSettings();
  }
});
onUnmounted(stopPushes);

/**
 * Repositories without a clone here: managed ones, those the searches found work in, and the ones
 * being cloned from here until they arrive in the table.
 */
const uncloned = computed(() => {
  const sources = settings.value?.sources ?? {};
  const found = status.value?.lastPoll?.discovered ?? {};
  const cloned = new Set((repos.value ?? []).map((r) => r.originUrl));
  const managed = Object.keys(sources).filter((o) => sources[o]!.managed && !cloned.has(o));
  const origins = new Set([...managed, ...Object.keys(found), ...Object.keys(cloning.value)]);
  return [...origins].sort().map((origin) => ({ origin, count: found[origin], managed: sources[origin]?.managed === true, ...cloning.value[origin] }));
});

async function stopManaging(origin: string) {
  error.value = undefined;
  try {
    const sources = settings.value?.sources ?? {};
    await saveSettings({ sources: { ...sources, [origin]: { assignOnStart: false, ...sources[origin], managed: false } } });
  } catch (e) {
    error.value = saveErrorText(e);
  }
}

async function cloneAndManage(origin: string) {
  cloning.value[origin] = {};
  try {
    const out = await api.cloneRepo(origin);
    if (out.result === "cloned") delete cloning.value[origin];
    else cloning.value[origin] = { path: out.path };
    await loadSettings();
  } catch (e) {
    cloning.value[origin] = { error: errorText(e) };
  }
}
</script>

<template>
  <section v-if="uncloned.length" class="panel">
    <div class="row" style="justify-content: space-between">
      <h2><IconBranch />Without a clone</h2>
      <span class="sub">Managed repositories without a clone here, and others where work is assigned to you or waits for your review.</span>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div v-for="u in uncloned" :key="u.origin" class="status-row" :class="{ warn: u.error }">
      <div class="w">
        <div class="h"><span class="mono" style="font-size: 13px">{{ u.origin }}</span><span v-if="u.managed" class="badge">managed</span></div>
        <div v-if="u.error" class="d danger-text">Clone failed: {{ u.error }}</div>
        <div v-else-if="u.path" class="d">Cloning into <span class="mono">{{ u.path }}</span>…</div>
        <div v-else-if="u.count" class="d">{{ u.count }} {{ u.count === 1 ? "item" : "items" }} found</div>
      </div>
      <div v-if="!u.path" class="row" style="gap: 8px">
        <button v-if="u.managed" class="btn sm ghost" type="button" @click="stopManaging(u.origin)">Stop managing</button>
        <button class="btn sm" type="button" :disabled="u.origin in cloning && !u.error" @click="cloneAndManage(u.origin)">
          {{ u.managed ? "Clone" : "Clone and manage" }}
        </button>
      </div>
    </div>
  </section>
</template>
