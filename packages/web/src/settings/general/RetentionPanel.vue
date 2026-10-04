<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import IconBook from "../../icons/IconBook.vue";
import { saveErrorText, saveSettings, settings } from "../store";
import { parseRetention, retentionInput } from "./retention";

/** Text, so an empty "delete after" can mean never (D37). */
const form = reactive({ archiveAfterHours: "", deleteAfterDays: "" });
watch(
  settings,
  (s) => {
    if (s) Object.assign(form, retentionInput(s));
  },
  { immediate: true },
);

const saving = ref(false);
const message = ref<{ text: string; tone: "ok" | "error" }>();

async function save() {
  message.value = undefined;
  const kept = parseRetention(form);
  if (!kept.ok) {
    message.value = { text: kept.error, tone: "error" };
    return;
  }
  saving.value = true;
  try {
    await saveSettings(kept.value);
    message.value = { text: "Saved. Applies on the next poll.", tone: "ok" };
  } catch (e) {
    message.value = { text: saveErrorText(e), tone: "error" };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="panel" @submit.prevent="save">
    <h2><IconBook />Finished items</h2>
    <div class="pair">
      <div class="field">
        <label for="set-archiveAfterHours">Archive after</label>
        <div class="row" style="flex-wrap: nowrap">
          <input id="set-archiveAfterHours" v-model="form.archiveAfterHours" class="input mono" inputmode="numeric" required style="max-width: 120px" /><span class="sub">hours</span>
        </div>
        <span class="help">Finished items (done and PR merged, or done without a PR) leave the board after this long and stay in the Archive. 0 hides them at once.</span>
      </div>
      <div class="field">
        <label for="set-deleteAfterDays">Delete after</label>
        <div class="row" style="flex-wrap: nowrap">
          <input id="set-deleteAfterDays" v-model="form.deleteAfterDays" class="input mono" inputmode="numeric" placeholder="never" style="max-width: 120px" /><span class="sub">days</span>
        </div>
        <span class="help">Archived items with their timeline and transcript are deleted after this long, unless they still have a worktree. Empty: never.</span>
      </div>
    </div>
    <div class="row">
      <button class="btn primary" type="submit" :disabled="saving || !settings">{{ saving ? "Saving…" : "Save" }}</button>
      <span v-if="message" :class="message.tone === 'error' ? 'danger-text' : 'sub'" role="status">{{ message.text }}</span>
    </div>
  </form>
</template>

<style scoped>
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 640px) {
  .pair { grid-template-columns: minmax(0, 1fr); }
}
</style>
