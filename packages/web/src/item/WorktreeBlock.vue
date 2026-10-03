<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { OpenTarget } from "../api/types";

const props = defineProps<{ itemId: string; path: string }>();
const error = ref<string>();

async function open(target: OpenTarget) {
  error.value = undefined;
  try {
    await api.open(props.itemId, target);
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="wt-h">
    <h2 id="wt-h">Worktree</h2>
    <p class="path mono">{{ path }}</p>
    <div class="buttons">
      <button class="btn" type="button" @click="open('finder')">Open in Finder</button>
      <button class="btn" type="button" @click="open('terminal')">Open in Terminal</button>
      <RouterLink :to="{ name: 'agent', params: { id: itemId } }" class="btn link">Transcript</RouterLink>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.path { margin: 12px 0; font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; user-select: all; }
.buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.link { display: inline-flex; align-items: center; text-decoration: none; }
.alert { margin-top: 10px; }
</style>
