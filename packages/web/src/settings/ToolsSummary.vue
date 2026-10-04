<script setup lang="ts">
import { computed } from "vue";
import { problems } from "../status/health";
import { reachable, status } from "../status/status";
import { claudeHint, ghHint, hintDot } from "./hints";

const rows = computed(() => {
  const gh = status.value?.gh;
  const claude = status.value?.claude;
  return [
    { name: "gh", hint: gh && ghHint(gh.state), detail: gh?.account ? `logged in as ${gh.account}` : undefined, path: gh?.path },
    { name: "claude", hint: claude && claudeHint(claude.state), detail: claude?.version, path: claude?.path },
  ];
});
const list = computed(() => problems(status.value, reachable.value));
</script>

<template>
  <div class="tools">
    <h3>Tools</h3>
    <ul>
      <li v-for="row in rows" :key="row.name" :title="row.path">
        <span class="dot" :class="hintDot(row.hint)" aria-hidden="true"></span>
        <strong>{{ row.name }}</strong>
        <span>{{ row.hint?.label ?? "checking…" }}</span>
        <span v-if="row.detail" class="detail mono">{{ row.detail }}</span>
      </li>
    </ul>
    <div v-if="list.length" role="status" class="problems">
      <ul>
        <li v-for="p in list" :key="p">{{ p }}</li>
      </ul>
      <p>Fixes are in the Sources panel.</p>
    </div>
  </div>
</template>

<style scoped>
.tools { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--fg-2); }
ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
li { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dot { align-self: center; }
.detail { color: var(--fg-2); font-size: 12px; }
.problems { margin-top: 12px; padding: 8px 10px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); font-size: 12px; }
.problems p { margin: 6px 0 0; }
</style>
