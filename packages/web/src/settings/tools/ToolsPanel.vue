<script setup lang="ts">
import { computed, ref } from "vue";
import { errorText } from "../../api/errors";
import IconRefresh from "../../icons/IconRefresh.vue";
import IconTerminal from "../../icons/IconTerminal.vue";
import { recheck, status } from "../../status/status";
import { toolGroups, type ToolCategory } from "./catalog";
import { hintDot } from "./hints";

const props = defineProps<{ title: string; categories: ToolCategory[] }>();

const groups = computed(() => toolGroups(status.value, props.categories));
/** Sub-headings only when the panel shows more than one category. */
const headed = computed(() => groups.value.length > 1);

const busy = ref(false);
const error = ref<string>();

async function check() {
  busy.value = true;
  error.value = undefined;
  try {
    await recheck();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="panel">
    <div class="row" style="justify-content: space-between">
      <h2><IconTerminal />{{ title }}</h2>
      <button class="btn sm" type="button" :disabled="busy" @click="check"><IconRefresh class="ic-sm" />{{ busy ? "Checking…" : "Check again" }}</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <template v-for="(g, i) in groups" :key="g.category">
      <div v-if="headed" style="font-weight: 500" :style="i > 0 ? 'margin-top: 12px' : undefined">{{ g.label }}</div>
      <div v-for="r in g.rows" :key="r.id" class="status-row" :class="{ warn: r.hint?.tone === 'warn' }">
        <span class="dot" :class="hintDot(r.hint)" style="margin-top: 6px"></span>
        <div class="w">
          <div class="h">
            {{ r.name }} <span class="badge muted mono">{{ r.tag }}</span>
            <span v-if="!r.hint" class="badge muted">checking…</span>
            <span v-else-if="r.hint.tone === 'ok'" class="badge ok">{{ r.ready }}</span>
            <span v-else-if="r.hint.tone === 'muted'" class="badge muted">{{ r.hint.label }}</span>
            <span v-else class="badge attn">{{ r.hint.label }}</span>
          </div>
          <template v-if="r.hint?.command">
            <div class="d">{{ r.hint.why }}</div>
            <div class="code" style="margin-top: 4px; user-select: all">{{ r.hint.command }}</div>
          </template>
          <div v-else class="d mono">{{ r.detail }}</div>
        </div>
      </div>
      <div v-for="p in g.planned" :key="p.id" class="status-row" style="border-style: dashed; color: var(--fg-3)">
        <span class="dot off" style="margin-top: 6px"></span>
        <div class="w">
          <div class="h" style="color: var(--fg-2)">{{ p.name }} <span class="badge muted">planned · #{{ p.issue }}</span></div>
          <div class="d">{{ p.note }}</div>
        </div>
      </div>
    </template>
  </section>
</template>
