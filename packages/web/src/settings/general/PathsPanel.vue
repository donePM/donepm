<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import type { WorktreeChoice } from "../../api/client";
import type { WorktreeAtOldRoot } from "../../api/types";
import IconFolder from "../../icons/IconFolder.vue";
import { saveErrorText, saveSettings, settings, type SettingsPatch } from "../store";
import MoveWorktreesDialog from "./MoveWorktreesDialog.vue";
import { moveResult, worktreesAtOldRoot } from "./move-worktrees";

const form = reactive({ repoRoot: "", worktreeRoot: "", branchPrefix: "" });
watch(
  settings,
  (s) => {
    if (s) Object.assign(form, { repoRoot: s.repoRoot, worktreeRoot: s.worktreeRoot, branchPrefix: s.branchPrefix });
  },
  { immediate: true },
);

const saving = ref(false);
const message = ref<{ text: string; tone: "ok" | "error" }>();
/** A new worktree root with worktrees under the old one: the daemon saves nothing until the user chose (#93). */
const pending = ref<{ patch: SettingsPatch; worktrees: WorktreeAtOldRoot[] }>();

async function send(patch: SettingsPatch, choice?: WorktreeChoice) {
  saving.value = true;
  message.value = undefined;
  try {
    const { worktrees } = await saveSettings(patch, choice);
    message.value = { text: worktrees ? moveResult(worktrees) : "Saved.", tone: "ok" };
  } catch (e) {
    const atOldRoot = worktreesAtOldRoot(e);
    if (atOldRoot && !choice) pending.value = { patch, worktrees: atOldRoot };
    else message.value = { text: saveErrorText(e), tone: "error" };
  } finally {
    saving.value = false;
  }
}

async function choose(choice: WorktreeChoice) {
  if (!pending.value) return;
  await send(pending.value.patch, choice);
  pending.value = undefined;
}
</script>

<template>
  <form class="panel" @submit.prevent="send({ ...form })">
    <h2><IconFolder />Folders and branches</h2>
    <div class="field">
      <label for="set-repoRoot">Repository root</label>
      <input id="set-repoRoot" v-model="form.repoRoot" class="input mono" required spellcheck="false" />
      <span class="help">Where your clones live. donePM looks for git repositories with a GitHub origin up to four levels below it, and clones new ones here.</span>
    </div>
    <div class="field">
      <label for="set-worktreeRoot">Worktree root</label>
      <input id="set-worktreeRoot" v-model="form.worktreeRoot" class="input mono" required spellcheck="false" />
      <span class="help">Each item's agent works in its own git worktree under this folder.</span>
      <span v-if="settings?.previousWorktreeRoots.length" class="help">
        Former roots that still hold worktrees: <template v-for="(r, i) in settings.previousWorktreeRoots" :key="r"><template v-if="i">, </template><span class="mono">{{ r }}</span></template>.
      </span>
    </div>
    <div class="field">
      <label for="set-branchPrefix">Branch prefix</label>
      <input id="set-branchPrefix" v-model="form.branchPrefix" class="input mono" required spellcheck="false" style="max-width: 200px" />
      <span class="help">New branches are named <span class="mono">{{ form.branchPrefix }}&lt;number&gt;-&lt;title&gt;</span>.</span>
    </div>
    <div class="row">
      <button class="btn primary" type="submit" :disabled="saving || !settings">{{ saving ? "Saving…" : "Save" }}</button>
      <span v-if="message" :class="message.tone === 'error' ? 'danger-text' : 'sub'" role="status">{{ message.text }}</span>
    </div>
    <MoveWorktreesDialog v-if="pending" :worktrees="pending.worktrees" :busy="saving" @choose="choose" @close="pending = undefined" />
  </form>
</template>
