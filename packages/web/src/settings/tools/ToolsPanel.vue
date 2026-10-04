<script setup lang="ts">
import { computed, ref } from "vue";
import { errorText } from "../../api/errors";
import IconRefresh from "../../icons/IconRefresh.vue";
import IconTerminal from "../../icons/IconTerminal.vue";
import { recheck, status } from "../../status/status";
import { claudeHint, ghHint, hintDot, type CliHint } from "./hints";

interface ToolRow {
  name: string;
  /** "gh", "claude 2.1.270". */
  tag: string;
  hint?: CliHint;
  /** Shown in a green badge when ready. */
  ready: string;
  detail: string;
}

const rows = computed<ToolRow[]>(() => {
  const gh = status.value?.gh;
  const claude = status.value?.claude;
  return [
    {
      name: "GitHub CLI",
      tag: "gh",
      hint: gh && ghHint(gh.state),
      ready: gh?.account ? `logged in as ${gh.account}` : "ready",
      detail: [gh?.path, "used for polling, PR creation, merges and comments"].filter(Boolean).join(" · "),
    },
    {
      name: "Claude Code",
      tag: claude?.version ? `claude ${claude.version}` : "claude",
      hint: claude && claudeHint(claude.state),
      ready: "ready",
      detail: [claude?.path, "runs the agents"].filter(Boolean).join(" · "),
    },
  ];
});

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
      <h2><IconTerminal />Tools</h2>
      <button class="btn sm" type="button" :disabled="busy" @click="check"><IconRefresh class="ic-sm" />{{ busy ? "Checking…" : "Check again" }}</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div v-for="r in rows" :key="r.tag" class="status-row" :class="{ warn: r.hint?.tone === 'warn' }">
      <span class="dot" :class="hintDot(r.hint)" style="margin-top: 6px"></span>
      <div class="w">
        <div class="h">
          {{ r.name }} <span class="badge muted mono">{{ r.tag }}</span>
          <span v-if="!r.hint" class="badge muted">checking…</span>
          <span v-else-if="r.hint.tone === 'ok'" class="badge ok">{{ r.ready }}</span>
          <span v-else class="badge attn">{{ r.hint.label }}</span>
        </div>
        <template v-if="r.hint?.command">
          <div class="d">{{ r.hint.why }}</div>
          <div class="code" style="margin-top: 4px; user-select: all">{{ r.hint.command }}</div>
        </template>
        <div v-else class="d mono">{{ r.detail }}</div>
      </div>
    </div>
    <div class="status-row" style="border-style: dashed; color: var(--fg-3)">
      <span class="dot off" style="margin-top: 6px"></span>
      <div class="w">
        <div class="h" style="color: var(--fg-2)">Jira CLI <span class="badge muted">after MVP</span></div>
        <div class="d">Will use <span class="mono">acli</span> or <span class="mono">jira-cli</span>, or a token in the keychain.</div>
      </div>
    </div>
  </section>
</template>
