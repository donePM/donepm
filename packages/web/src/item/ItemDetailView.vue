<script setup lang="ts">
import { feedbackEntries } from "@donepm/core";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { pending, resumeAgent, startAgent } from "../agents/actions";
import AnsiText from "../ansi/AnsiText.vue";
import { errorText } from "../api/errors";
import AskPanel from "../asks/AskPanel.vue";
import CloneButton from "../board/CloneButton.vue";
import CiPendingDot from "../ci/CiPendingDot.vue";
import { displayId } from "../board/columns";
import { diffFiles, diffStats } from "../diff/files";
import DiffPanel from "../diff/DiffPanel.vue";
import MarkdownView from "../markdown/MarkdownView.vue";
import { repoOf } from "../markdown/render";
import { agentElapsed, clock, money, usageLabel } from "../time/duration";
import { loadPlaybookEntries, playbookEntries } from "../board/playbook-options";
import { useNow } from "../time/now";
import { timeLabel } from "../timeline/entries";
import TimelineList from "../timeline/TimelineList.vue";
import { useItemDetail } from "./detail";
import CiPanel from "./CiPanel.vue";
import ConflictPanel from "./ConflictPanel.vue";
import DraftPanel from "./DraftPanel.vue";
import FeedbackPanel from "./FeedbackPanel.vue";
import PushDraftPanel from "./PushDraftPanel.vue";
import ReviewDraftPanel from "./ReviewDraftPanel.vue";
import UpdateBranchDraftPanel from "./UpdateBranchDraftPanel.vue";
import SourceLink from "../sourcelink/SourceLink.vue";
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
const feedback = computed(() => feedbackEntries(detail.value?.events ?? []));
const files = computed(() => (diff.value ? diffFiles(diff.value.patch) : undefined));
const stats = computed(() => (files.value ? diffStats(files.value) : undefined));

/** `?tab=changes|timeline`; the first tab holds what needs the user, the CI, the PR and the issue (spec 12.2). */
type Tab = "overview" | "changes" | "timeline";
const tab = computed<Tab>(() => {
  const t = route.query?.tab;
  return t === "changes" || t === "timeline" ? t : "overview";
});
const tabTo = (t: Tab) => ({ query: t === "overview" ? {} : { tab: t } });
/** "Draft" while a draft waits for the user, else "Overview". */
const firstTab = computed(() => (draft.value ? "Draft" : "Overview"));

onMounted(() => void loadPlaybookEntries());
/** "implement · opus": the model from the playbook file, when it is known. */
const playbookLabel = computed(() => {
  const d = detail.value;
  if (!d) return "";
  const own = playbookEntries.value.filter((e) => e.name === d.playbook);
  const e = own.find((x) => x.scope.kind === "repo" && x.scope.repoId === d.repo?.id) ?? own.find((x) => x.scope.kind === "global");
  return e ? `${d.playbook} · ${e.model}` : d.playbook;
});
/** "11 min · $0.86": how long the agent worked and what it cost. */
const work = computed(() => {
  const d = detail.value;
  if (!d) return undefined;
  const ms = agentElapsed(d.agent, now.value);
  const parts = [ms !== undefined ? clock(ms) : undefined, d.agent.costUsd !== undefined ? money(d.agent.costUsd) : undefined].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
});
const tokensLabel = computed(() => usageLabel(detail.value?.agent.usage));

const STATE_LABEL: Record<string, string> = {
  ready: "Ready",
  running: "Running",
  checking: "Waiting for CI",
  needs_you: "Needs you",
  failed: "Failed",
  done: "Done",
};
const DRAFT_LABEL: Record<string, string> = { pr: "PR draft", push: "push draft", comment: "reply draft", review: "review draft", update_branch: "update-branch draft" };
const BADGE_TONE: Record<string, string> = { needs_you: "attn", failed: "attn", running: "primary", checking: "primary", done: "ok", ready: "" };
const badge = computed(() => {
  const d = detail.value;
  if (!d) return "";
  const label = STATE_LABEL[d.state] ?? d.state;
  if (d.attention?.kind === "draft") return `${label} · ${DRAFT_LABEL[d.attention.draftType] ?? "draft"}`;
  if (d.attention?.kind === "ci_failed") return `${label} · CI failed`;
  if (d.attention?.kind === "pr_conflict") return `${label} · merge conflict`;
  if (d.attention?.kind === "pr_feedback") return `${label} · review feedback`;
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
  <div class="item-page">
    <p v-if="error" class="alert top-alert" role="alert">Could not load the item: {{ error }}</p>
    <template v-if="detail">
      <nav class="crumb" aria-label="Breadcrumb">
        <RouterLink to="/">← Board</RouterLink>
        <span aria-hidden="true">/</span>
        <span class="mono">{{ displayId(detail.externalId).replace("#", " #") }}</span>
        <span class="badge state" :class="BADGE_TONE[detail.state]"><CiPendingDot v-if="detail.state === 'checking'" />{{ badge }}</span>
      </nav>
      <div class="title">
        <h1>{{ detail.title }}</h1>
        <div class="m">
          <span class="badge primary" title="Playbook">{{ playbookLabel }}</span>
          <span v-if="detail.branch"><template v-if="detail.source === 'github-pr'">reviewing </template>{{ detail.branch }} → {{ detail.baseBranch ?? detail.repo?.defaultBranch ?? "?" }}</span>
          <span v-if="diff">{{ diff.commits }} {{ diff.commits === 1 ? "commit" : "commits" }}</span>
          <span v-if="stats"><span class="add">+{{ stats.additions }}</span> <span class="del">−{{ stats.deletions }}</span></span>
          <span v-if="work" title="How long the agent worked · its cost">{{ work }}</span>
          <span v-if="tokensLabel" title="Tokens: input includes cache reads and writes">{{ tokensLabel }}</span>
          <SourceLink :source="detail.source" :url="detail.externalUrl" class="ext">{{ detail.source === "github-pr" ? "PR" : "issue" }}</SourceLink>
        </div>
        <div v-if="detail.badges.includes('no-local-clone')" class="no-clone">
          <span>No local clone<template v-if="detail.clone">. Clone lands in <span class="mono">{{ detail.clone.target }}</span></template></span>
          <CloneButton v-if="detail.clone" :clone="detail.clone" />
        </div>
      </div>

      <main class="layout">
        <div class="main">
          <nav class="tabs" aria-label="Item">
            <RouterLink :to="tabTo('overview')" :class="{ on: tab === 'overview' }" :aria-current="tab === 'overview' ? 'page' : undefined">{{ firstTab }}</RouterLink>
            <RouterLink v-if="detail.worktreePath" :to="tabTo('changes')" :class="{ on: tab === 'changes' }" :aria-current="tab === 'changes' ? 'page' : undefined">
              Changes<span v-if="files" class="badge muted count">{{ files.length }}</span>
            </RouterLink>
            <RouterLink v-if="detail.startedAt" :to="{ name: 'agent', params: { id: detail.id } }">Transcript</RouterLink>
            <RouterLink :to="tabTo('timeline')" :class="{ on: tab === 'timeline' }" :aria-current="tab === 'timeline' ? 'page' : undefined">Timeline</RouterLink>
          </nav>
          <template v-if="tab === 'overview'">
            <section v-for="a in askPending" :key="a.id" class="needs" aria-label="Permission question">
              <h2>The agent asks for permission</h2>
              <AskPanel
                :ask-id="a.id"
                :tool-name="a.toolName"
                :input="a.input"
                :rules="a.rules"
                :reason="a.reason"
                :worktree="detail.worktreePath"
                :repo="repo"
                @answered="reload"
              />
            </section>
            <PushDraftPanel
              v-if="(draft?.type === 'push' || draft?.type === 'comment') && detail.state === 'needs_you'"
              :draft="draft"
              :feedback="feedback"
              :repo="repo"
              :created-at="draftCreatedAt"
              :can-reject="detail.agent.running || !!detail.agentSessionId"
              :publish-error="publishError"
              @changed="reload"
            />
            <ReviewDraftPanel
              v-else-if="draft?.type === 'review' && detail.state === 'needs_you'"
              :draft="draft"
              :repo="repo"
              :created-at="draftCreatedAt"
              :can-reject="detail.agent.running || !!detail.agentSessionId"
              :publish-error="publishError"
              @changed="reload"
            />
            <UpdateBranchDraftPanel
              v-else-if="draft?.type === 'update_branch' && detail.state === 'needs_you'"
              :draft="draft"
              :created-at="draftCreatedAt"
              :can-reject="detail.agent.running || !!detail.agentSessionId"
              :publish-error="publishError"
              @changed="reload"
            />
            <DraftPanel
              v-else-if="draft?.type === 'pr' && detail.state === 'needs_you'"
              :draft="draft"
              :created-at="draftCreatedAt"
              :can-reject="detail.agent.running || !!detail.agentSessionId"
              :publish-error="publishError"
              :repo="repo"
              @changed="reload"
            />
            <ConflictPanel :item="detail" @changed="reload" />
            <FeedbackPanel :item="detail" :repo="repo" @changed="reload" />
            <CiPanel :item="detail" @changed="reload" />
            <section v-if="detail.pr" class="panel" aria-labelledby="pr-h">
              <h2 id="pr-h">Pull request</h2>
              <a :href="detail.pr.url" target="_blank" rel="noreferrer" class="mono pr-link">#{{ detail.pr.number }} · {{ detail.pr.url }}</a>
            </section>
            <section v-if="interrupted" class="needs" aria-label="Interrupted">
              <h2>The agent stopped: {{ interrupted.reason }}</h2>
              <p class="hint">Resume continues its session in the same worktree.</p>
              <div>
                <button class="btn primary" type="button" :disabled="pending.has(detail.id)" @click="retry(detail.id, resumeAgent)">Resume</button>
              </div>
              <p v-if="retryError" class="alert" role="alert">{{ retryError }}</p>
            </section>
            <section v-if="failure" class="needs" aria-label="Failure">
              <h2>The agent failed: {{ failure.reason }}</h2>
              <pre v-if="failure.stderrTail" class="stderr mono on-code"><AnsiText :text="failure.stderrTail" /></pre>
              <div>
                <button class="btn primary" type="button" :disabled="pending.has(detail.id)" @click="retry(detail.id)">Retry</button>
              </div>
              <p v-if="retryError" class="alert" role="alert">{{ retryError }}</p>
            </section>
            <section v-if="detail.body.trim()" class="panel" aria-labelledby="issue-h">
              <h2 id="issue-h">{{ detail.source === "github-pr" ? "Pull request" : "Issue" }}</h2>
              <MarkdownView class="body" :source="detail.body" :repo="repo" />
            </section>
          </template>
          <DiffPanel v-else-if="tab === 'changes' && detail.worktreePath" :diff="diff" :loading="diffLoading" :error="diffError" @refresh="reloadDiff" />
          <TimelineList v-else-if="tab === 'timeline'" :events="detail.events" :asks="detail.asks" :now="now" />
        </div>
        <aside v-if="detail.worktreePath" class="side">
          <WorktreeBlock
            :item-id="detail.id"
            :path="detail.worktreePath"
            :session-id="detail.agentSessionId"
            :removable="(detail.state === 'done' || detail.state === 'failed') && !detail.agent.running"
            @removed="reload"
          />
        </aside>
      </main>
    </template>
  </div>
</template>

<style scoped>
.crumb { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--fg-3); flex-wrap: wrap; padding: 16px 20px 0; }
.crumb a { color: var(--fg-3); text-decoration: none; }
.crumb a:hover { color: var(--fg); }
.state { gap: 6px; }
.title { padding: 8px 20px 0; }
.title h1 { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.title .m { margin-top: 6px; font-family: var(--mono); font-size: 12px; color: var(--fg-3); display: flex; gap: 6px 10px; flex-wrap: wrap; align-items: center; overflow-wrap: anywhere; }
.title .m .badge { font-family: var(--sans); }
.add { color: var(--ok); }
.del { color: var(--danger); }
.ext { color: var(--primary); text-decoration: none; }
.ext:hover { text-decoration: underline; }
.no-clone { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; color: var(--fg-3); font-size: 13px; overflow-wrap: anywhere; }
.layout { padding: 20px; display: flex; flex-wrap: wrap; gap: 20px; align-items: start; }
.main { flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.side { flex: 1 1 300px; max-width: 380px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.count { margin-left: 6px; }
.needs {
  background: var(--attn-tint);
  border: 1px solid var(--attn-border);
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hint { margin: 0; font-size: 13px; color: var(--fg-2); }
.needs h2, .panel h2 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.pr-link { display: block; margin-top: 8px; overflow-wrap: anywhere; }
.stderr {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-fg);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
}
.body { margin-top: 12px; }
.top-alert { margin: 16px 20px 0; }
/* Below the two columns the side panels follow the main one at full width. */
@media (max-width: 900px) {
  .side { max-width: none; }
}
@media (max-width: 640px) {
  .crumb { padding: 12px 16px 0; }
  .title { padding: 8px 16px 0; }
  .layout { padding: 16px; }
}
</style>
