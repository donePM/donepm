<script setup lang="ts">
import { computed, ref } from "vue";
import { fixCi, markCiDone, pending, rerunCi } from "../agents/actions";
import { errorText } from "../api/errors";
import type { ItemDetail } from "../api/types";

/** The item's CI (D35): waiting for it, or red with the failed checks and their log ends. */
const props = defineProps<{ item: ItemDetail }>();
const emit = defineEmits<{ changed: [] }>();

const failure = computed(() => (props.item.attention?.kind === "ci_failed" ? props.item.attention : undefined));
const busy = computed(() => pending.value.has(props.item.id));
const logOf = (name: string) => failure.value?.logs.find((l) => l.name === name)?.tail;

const error = ref<string>();
async function act(fn: (id: string) => Promise<void>) {
  error.value = undefined;
  try {
    await fn(props.item.id);
    emit("changed");
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <section v-if="failure" class="needs" aria-label="CI failed">
    <h2>CI failed on <a v-if="failure.pr" :href="failure.pr.url" target="_blank" rel="noreferrer">PR #{{ failure.pr.number }}</a><template v-else>the pull request</template></h2>
    <div v-for="c in failure.failed" :key="c.name" class="check">
      <h3 class="mono">
        <a v-if="c.link" :href="c.link" target="_blank" rel="noreferrer">{{ c.name }}</a><template v-else>{{ c.name }}</template>
      </h3>
      <pre v-if="logOf(c.name)" class="log mono">{{ logOf(c.name) }}</pre>
    </div>
    <p class="hint">Fix with agent resumes its session with these checks and logs. It proposes the fix as a push draft.</p>
    <div class="actions">
      <button class="btn btn-primary" type="button" :disabled="busy || !item.agentSessionId" @click="act(fixCi)">Fix with agent</button>
      <button v-if="failure.runs.length" class="btn" type="button" :disabled="busy" title="gh run rerun --failed" @click="act(rerunCi)">Rerun failed jobs</button>
      <button class="btn subtle" type="button" :disabled="busy" @click="act(markCiDone)">Mark done</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </section>
  <section v-else-if="item.state === 'checking'" class="panel" aria-label="Waiting for CI">
    <h2>Waiting for CI<template v-if="item.pr"> on <a :href="item.pr.url" target="_blank" rel="noreferrer">PR #{{ item.pr.number }}</a></template></h2>
    <p class="hint">The item moves to Done once every check passed, or back to you if one fails.</p>
    <div class="actions">
      <button class="btn subtle" type="button" :disabled="busy" @click="act(markCiDone)">Mark done now</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.needs, .panel { border-radius: 8px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.needs { background: var(--amber-tint); border: 1px solid var(--amber-border); }
.panel { background: var(--card); border: 1px solid var(--border); }
h2 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.hint { margin: 0; font-size: 13px; color: var(--ink-2); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.log {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-ink);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
}
</style>
