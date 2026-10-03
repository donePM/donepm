<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { pending, resumeAgent, startAgent } from "../agents/actions";
import { errorText } from "../api/errors";
import AskPanel from "../asks/AskPanel.vue";
import { displayId } from "../board/columns";
import { diffFiles, diffStats } from "../diff/files";
import DiffPanel from "../diff/DiffPanel.vue";
import MarkdownView from "../markdown/MarkdownView.vue";
import { repoOf } from "../markdown/render";
import { money } from "../time/duration";
import { useNow } from "../time/now";
import { timeLabel } from "../timeline/entries";
import TimelineList from "../timeline/TimelineList.vue";
import { useItemDetail } from "./detail";
import DraftPanel from "./DraftPanel.vue";
import WorktreeBlock from "./WorktreeBlock.vue";

const route = useRoute();
const id = computed(() => String(route.params.id));
const { detail, error, diff, diffError, diffLoading, reload, reloadDiff } = useItemDetail(id);
const now = useNow(30_000);

const askPending = computed(() => detail.value?.asks.filter((a) => a.state === "pending") ?? []);
/** Pending, being published, or failed to publish: still the user's to decide. */
const draft = computed(() => detail.value?.drafts.find((d) => d.state === "pending" || d.state === "approved" || d.state === "failed"));
const publishError = computed(() => (detail.value?.attention?.kind === "draft" ? detail.value.attention.error : undefined));
const draftCreatedAt = computed(() => {
  const e = [...(detail.value?.events ?? [])].reverse().find((x) => x.type === "draft.created" && x.refId === draft.value?.id);
  return e ? timeLabel(e.at, new Date(now.value)) : undefined;
});
const repo = computed(() => (detail.value ? repoOf(detail.value.externalId) : undefined));
const stats = computed(() => (diff.value ? diffStats(diffFiles(diff.value.patch)) : undefined));

const STATE_LABEL: Record<string, string> = {
  ready: "Ready",
  running: "Running",
  needs_you: "Needs you",
  failed: "Failed",
  done: "Done",
};
const badge = computed(() => {
  const d = detail.value;
  if (!d) return "";
  const label = STATE_LABEL[d.state] ?? d.state;
  if (d.attention?.kind === "draft") return `${label} · PR draft`;
  if (d.attention?.kind === "ask") return `${label} · permission`;
  if (d.attention?.kind === "resume") return `${label} · interrupted`;
  return label;
});
const retryError = ref<string>();
async function retry(id: string, call = startAgent) {
  retryError.value = undefined;
  try {
    await call(id);
  } catch (e) {
    retryError.value = errorText(e);
  }
}
const interrupted = computed(() => (detail.value?.attention?.kind === "resume" ? detail.value.attention : undefined));
const failure = computed(() => (detail.value?.attention?.kind === "failed" ? detail.value.attention : undefined));
</script>

<template>
  <main class="page">
    <p v-if="error" class="alert" role="alert">Could not load the item: {{ error }}</p>
    <template v-if="detail">
      <nav class="crumbs" aria-label="Breadcrumb">
        <RouterLink to="/">← Board</RouterLink>
        <span aria-hidden="true">/</span>
        <a class="mono ext" :href="detail.externalUrl" target="_blank" rel="noreferrer">{{ displayId(detail.externalId) }}</a>
        <span class="state" :class="`s-${detail.state}`">{{ badge }}</span>
      </nav>
      <h1>{{ detail.title }}</h1>
      <p v-if="detail.branch" class="facts mono">
        {{ detail.branch }} → {{ detail.repo?.defaultBranch ?? "?" }}
        <template v-if="diff"> · {{ diff.commits }} {{ diff.commits === 1 ? "commit" : "commits" }}</template>
        <template v-if="stats"> · +{{ stats.additions }} −{{ stats.deletions }}</template>
        <template v-if="detail.agent.costUsd !== undefined"> · agent cost {{ money(detail.agent.costUsd) }}</template>
      </p>

      <div class="layout">
        <div class="main">
          <section v-for="a in askPending" :key="a.id" class="needs" aria-label="Permission question">
            <h2>The agent asks for permission</h2>
            <AskPanel :ask-id="a.id" :tool-name="a.toolName" :input="a.input" :rules="a.rules" @answered="reload" />
          </section>
          <DraftPanel
            v-if="draft && detail.state === 'needs_you'"
            :draft="draft"
            :created-at="draftCreatedAt"
            :can-reject="detail.agent.running || !!detail.agentSessionId"
            :publish-error="publishError"
            :repo="repo"
            @changed="reload"
          />
          <section v-if="detail.pr" class="panel" aria-labelledby="pr-h">
            <h2 id="pr-h">Pull request</h2>
            <a :href="detail.pr.url" target="_blank" rel="noreferrer" class="mono">#{{ detail.pr.number }} · {{ detail.pr.url }}</a>
          </section>
          <section v-if="interrupted" class="needs" aria-label="Interrupted">
            <h2>The agent stopped: {{ interrupted.reason }}</h2>
            <p class="hint">Resume continues its session in the same worktree.</p>
            <div>
              <button class="btn btn-primary" type="button" :disabled="pending.has(detail.id)" @click="retry(detail.id, resumeAgent)">Resume</button>
            </div>
            <p v-if="retryError" class="alert" role="alert">{{ retryError }}</p>
          </section>
          <section v-if="failure" class="needs" aria-label="Failure">
            <h2>The agent failed: {{ failure.reason }}</h2>
            <pre v-if="failure.stderrTail" class="stderr mono">{{ failure.stderrTail }}</pre>
            <div>
              <button class="btn btn-primary" type="button" :disabled="pending.has(detail.id)" @click="retry(detail.id)">Retry</button>
            </div>
            <p v-if="retryError" class="alert" role="alert">{{ retryError }}</p>
          </section>
          <DiffPanel v-if="detail.worktreePath" :diff="diff" :loading="diffLoading" :error="diffError" @refresh="reloadDiff" />
          <section v-if="detail.body.trim()" class="panel" aria-labelledby="issue-h">
            <h2 id="issue-h">Issue</h2>
            <MarkdownView class="body" :source="detail.body" :repo="repo" />
          </section>
        </div>
        <aside class="side">
          <TimelineList :events="detail.events" :asks="detail.asks" :now="now" />
          <WorktreeBlock
            v-if="detail.worktreePath"
            :item-id="detail.id"
            :path="detail.worktreePath"
            :removable="(detail.state === 'done' || detail.state === 'failed') && !detail.agent.running"
            @removed="reload"
          />
        </aside>
      </div>
    </template>
  </main>
</template>

<style scoped>
.page { padding: 20px 24px 40px; max-width: 1480px; }
.crumbs { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: var(--ink-3); }
.crumbs a { color: var(--ink-2); text-decoration: none; }
.crumbs a:hover { color: var(--blue); }
.state { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--border-soft); color: var(--ink-2); }
.state.s-needs_you, .state.s-failed { background: var(--amber-tint); color: var(--amber); }
.state.s-running { background: var(--blue-tint); color: var(--blue); }
h1 { margin: 12px 0 6px; font-size: 22px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.facts { margin: 0 0 20px; color: var(--ink-2); font-size: 13px; overflow-wrap: anywhere; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
.main, .side { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.needs {
  background: var(--amber-tint);
  border: 1px solid var(--amber-border);
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hint { margin: 0; font-size: 13px; color: var(--ink-2); }
.needs h2, .panel h2 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.stderr {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-ink);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
}
.body { margin-top: 12px; }
.alert { margin-bottom: 16px; }
@media (max-width: 1000px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .page { padding: 16px; }
}
</style>
