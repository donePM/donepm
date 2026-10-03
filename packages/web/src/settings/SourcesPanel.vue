<script setup lang="ts">
import { computed, ref } from "vue";
import { recheck, status } from "../status/status";
import { useNow } from "../time/now";
import { ago } from "../time/relative";
import CliCard from "./CliCard.vue";
import { claudeHint, ghHint } from "./hints";

defineProps<{ pollSeconds?: number }>();

const busy = ref(false);
const error = ref<string>();
const now = useNow();

async function check() {
  busy.value = true;
  error.value = undefined;
  try {
    await recheck();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const gh = computed(() => status.value?.gh);
const claude = computed(() => status.value?.claude);
const ghDetail = computed(() => (gh.value?.account ? `logged in as ${gh.value.account}` : gh.value?.path));
const claudeDetail = computed(() => [claude.value?.version, claude.value?.path].filter(Boolean).join(" · "));
const poll = computed(() => status.value?.lastPoll);
</script>

<template>
  <section class="panel">
    <h2>Sources</h2>
    <p class="sub">donePM uses command-line tools that are already logged in. It never stores your tokens.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="list">
      <CliCard name="GitHub" :detail="ghDetail" :hint="gh && ghHint(gh.state)" :busy="busy" @recheck="check">
        <div v-if="gh?.state === 'ready'" class="line">
          Collecting: issues assigned to you<template v-if="pollSeconds"> · every {{ pollSeconds }} s</template>
          <template v-if="poll">
            · last run {{ ago(poll.at, now) }},
            <span v-if="poll.ok">{{ poll.issues ?? 0 }} issues</span>
            <span v-else class="failed" :title="poll.error">failed</span>
          </template>
        </div>
      </CliCard>
      <CliCard name="Claude Code" :detail="claudeDetail" :hint="claude && claudeHint(claude.state)" :busy="busy" @recheck="check" />
    </div>
  </section>
</template>

<style scoped>
.list { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.line { color: var(--ink-2); }
.failed { color: var(--danger); }
.error { margin: 12px 0 0; color: var(--danger); }
</style>
