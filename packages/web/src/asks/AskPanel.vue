<script setup lang="ts">
import { toolSummary } from "@donepm/core";
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";

const props = defineProps<{ askId: string; toolName: string; input: unknown }>();
const emit = defineEmits<{ answered: [] }>();

/** The command or path when the tool has one, else the input as JSON. */
const shown = computed(() => toolSummary(props.toolName, props.input) || JSON.stringify(props.input, null, 2));

const denying = ref(false);
const message = ref("");
const busy = ref(false);
const error = ref<string>();

async function answer(behavior: "allow" | "deny") {
  busy.value = true;
  error.value = undefined;
  try {
    const msg = message.value.trim();
    await api.answer(props.askId, behavior === "allow" ? { behavior } : msg ? { behavior, message: msg } : { behavior });
    emit("answered");
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ask">
    <div class="code mono"><span class="tool">{{ toolName }}</span><pre>{{ shown }}</pre></div>
    <form v-if="denying" class="deny" @submit.prevent="answer('deny')">
      <label class="sr-only" :for="`deny-${askId}`">Message to the agent</label>
      <textarea :id="`deny-${askId}`" v-model="message" class="textarea" rows="2" placeholder="Why not, or what to do instead (optional)"></textarea>
      <div class="buttons">
        <button class="btn btn-danger" type="submit" :disabled="busy">Deny</button>
        <button class="btn" type="button" :disabled="busy" @click="denying = false">Cancel</button>
      </div>
    </form>
    <div v-else class="buttons">
      <button class="btn btn-primary" type="button" :disabled="busy" @click="answer('allow')">Allow</button>
      <button class="btn" type="button" :disabled="busy" @click="denying = true">Deny…</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.ask { display: flex; flex-direction: column; gap: 10px; }
.code { background: var(--code-bg); color: var(--code-ink); border-radius: 6px; padding: 10px 12px; font-size: 12px; }
.tool { display: block; color: #9a9a92; margin-bottom: 4px; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; font: inherit; }
.deny { display: flex; flex-direction: column; gap: 8px; }
.buttons { display: flex; gap: 8px; }
</style>
