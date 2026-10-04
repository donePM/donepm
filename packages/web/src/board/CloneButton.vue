<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { CloneState } from "../api/types";

/**
 * Clone for an item without a local clone (issue #37). The daemon runs `gh repo clone` into the
 * target; the item update that follows links the clone, shows "Cloning…" or the failure.
 */
const props = defineProps<{ clone: CloneState }>();

const requesting = ref(false);
/** Refused before anything ran, e.g. an occupied target. A failed clone comes with the item. */
const refused = ref<string>();
const error = computed(() => refused.value ?? props.clone.error);

async function run() {
  requesting.value = true;
  refused.value = undefined;
  try {
    await api.cloneRepo(props.clone.origin);
  } catch (e) {
    refused.value = errorText(e);
  } finally {
    requesting.value = false;
  }
}
</script>

<template>
  <button
    class="btn subtle clone"
    type="button"
    :disabled="requesting || clone.cloning"
    :title="`gh repo clone into ${clone.target}`"
    @click="run"
  >{{ clone.cloning ? "Cloning…" : "Clone" }}</button>
  <p v-if="error && !clone.cloning" class="clone-error mono" role="alert">{{ error }}</p>
</template>

<style scoped>
.clone { margin-left: auto; height: 26px; padding: 0 10px; font-size: 12px; flex: none; }
.clone-error {
  flex-basis: 100%;
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--danger-tint);
  color: var(--danger);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
