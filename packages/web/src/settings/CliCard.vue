<script setup lang="ts">
import { computed } from "vue";
import { hintDot, type CliHint } from "./hints";

const props = defineProps<{ name: string; detail?: string; hint?: CliHint; busy: boolean }>();
defineEmits<{ recheck: [] }>();

const tone = computed(() => props.hint?.tone ?? "off");
</script>

<template>
  <div class="cli" :class="`tone-${tone}`">
    <span class="dot" :class="hintDot(hint)" aria-hidden="true"></span>
    <div class="body">
      <div class="title">
        <strong>{{ name }}</strong>
        <span v-if="hint?.tone === 'ok'" class="detail mono">{{ detail }}</span>
        <span v-else-if="hint" class="state">{{ hint.label }}</span>
        <span v-else class="detail">checking…</span>
      </div>
      <slot />
      <template v-if="hint?.command">
        <p class="why">{{ hint.why }}</p>
        <div class="code command">{{ hint.command }}</div>
      </template>
    </div>
    <button class="btn recheck" :disabled="busy" @click="$emit('recheck')">Check again</button>
  </div>
</template>

<style scoped>
.cli {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}
.cli.tone-warn { background: var(--attn-tint); border-color: var(--attn-border); }
.dot { margin-top: 6px; }
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.title { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.title strong { font-size: 15px; font-weight: 600; }
.detail { color: var(--fg-2); font-size: 12px; }
.state { color: var(--attn); }
.why { margin: 4px 0; color: var(--fg-2); }
.command { user-select: all; }
.recheck { height: 30px; font-size: 13px; font-weight: 400; }
@media (max-width: 640px) {
  .cli { flex-wrap: wrap; }
}
</style>
