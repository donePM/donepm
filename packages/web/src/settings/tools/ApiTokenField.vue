<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../../api/client";
import { saveErrorText } from "../store";

/**
 * The API token of one `api` connection (D8 as amended): write-only. The token goes to the
 * Keychain through the daemon; this field only ever learns whether one is set.
 */
const props = defineProps<{ id: string; tokenSet: boolean | undefined; hint?: string }>();

/** What the last save or delete answered; the status catches up when the daemon rechecks. */
const answered = ref<boolean>();
const isSet = computed(() => answered.value ?? props.tokenSet ?? false);
const token = ref("");
const editing = ref(false);
const busy = ref(false);
const error = ref<string>();

async function save() {
  busy.value = true;
  error.value = undefined;
  try {
    answered.value = (await api.setToken(props.id, token.value)).tokenSet;
    token.value = "";
    editing.value = false;
  } catch (e) {
    error.value = saveErrorText(e);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  busy.value = true;
  error.value = undefined;
  try {
    answered.value = (await api.deleteToken(props.id)).tokenSet;
  } catch (e) {
    error.value = saveErrorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="token">
    <div v-if="!editing && isSet" class="row">
      <span class="badge ok">token set</span>
      <button class="btn sm" type="button" :disabled="busy" @click="editing = true">Replace</button>
      <button class="btn sm" type="button" :disabled="busy" @click="remove">Delete</button>
    </div>
    <form v-else class="row" @submit.prevent="save">
      <span v-if="!isSet" class="badge attn">no token</span>
      <input
        v-model="token"
        class="input mono"
        type="password"
        autocomplete="off"
        spellcheck="false"
        :aria-label="`API token for ${id}`"
        placeholder="Paste the API token"
        style="max-width: 320px"
      />
      <button class="btn sm primary" type="submit" :disabled="busy || !token.trim()">{{ busy ? "Saving…" : "Save token" }}</button>
      <button v-if="editing" class="btn sm" type="button" :disabled="busy" @click="(editing = false), (token = '')">Cancel</button>
    </form>
    <span v-if="hint" class="help">{{ hint }}</span>
    <p v-if="error" class="danger-text" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.token { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
</style>
