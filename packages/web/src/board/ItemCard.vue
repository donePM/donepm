<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { dismissConflict, dismissItem, fixCi, markCiDone, pending, removeWorktree, rerunCi, resolveConflict, resumeAgent, startAgent, stopAgent } from "../agents/actions";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { ItemView } from "../api/types";
import AskPanel from "../asks/AskPanel.vue";
import { repoOf } from "../markdown/render";
import { diffFiles, diffStats, type DiffStats } from "../diff/files";
import { agentElapsed, clock } from "../time/duration";
import { columnOf, displayId, labelTone, shortId } from "./columns";
import { isFinished } from "./finished";
import { mergeNote } from "./merge-note";

/**
 * `hideRepo`: the lane already names the repo, so the id shows only the number.
 * `removeOnMerge`: the user's `removeWorktreeOnMerge` (D33).
 */
const props = defineProps<{ item: ItemView; repoRoot?: string; now: number; hideRepo?: boolean; removeOnMerge?: boolean }>();

const noClone = computed(() => props.item.badges.includes("no-local-clone"));
const closedUpstream = computed(() => props.item.badges.includes("closed-upstream"));
/** A started item stays when its issue closes upstream; the user moves it to Done (D32). */
const dismissable = computed(() => closedUpstream.value && props.item.state !== "done" && props.item.state !== "running" && !props.item.agent.running);
const column = computed(() => columnOf(props.item));
/** Finished: muted, and nothing to do on it but open it (D37). The detail page still offers everything. */
const finished = computed(() => isFinished(props.item));
const busy = computed(() => pending.value.has(props.item.id));
/** Ready and failed items can start; a failed one starts again from its worktree. */
const startable = computed(() => (props.item.state === "ready" || props.item.state === "failed") && !noClone.value);
/** The user removes a finished or failed item's worktree; only a merged PR's goes on its own (D33). */
const removable = computed(() => (props.item.state === "done" || props.item.state === "failed") && !!props.item.worktreePath && !props.item.agent.running && !finished.value);
const merge = computed(() => mergeNote(props.item, props.removeOnMerge ?? false));
const elapsed = computed(() => {
  const ms = agentElapsed(props.item.agent, props.now);
  return ms === undefined ? undefined : clock(ms);
});

const attention = computed(() => props.item.attention);
const flag = computed(() => {
  const a = attention.value;
  if (!a) return undefined;
  if (a.kind === "draft" && a.draftType === "push") return a.error ? "Push failed" : a.executing ? "Pushing" : "Push draft";
  if (a.kind === "draft") return a.error ? "PR failed" : a.executing ? "Publishing" : "PR draft";
  if (a.kind === "ci_failed") return "CI failed";
  if (a.kind === "pr_conflict") return "Conflict";
  if (a.kind === "resume") return "Interrupted";
  return a.kind === "ask" ? "Permission" : "Failed";
});

/** `+84 −12 · 5 files · 2 commits` for a pending PR draft, loaded once per draft. A push draft's title says it all. */
const draftStats = ref<DiffStats & { commits: number }>();
watch(
  () => (attention.value?.kind === "draft" && attention.value.draftType === "pr" ? attention.value.draftId : undefined),
  async (draftId) => {
    draftStats.value = undefined;
    if (!draftId) return;
    try {
      const d = await api.diff(props.item.id);
      draftStats.value = { ...diffStats(diffFiles(d.patch)), commits: d.commits };
    } catch {
      // The stats are a hint; the detail view shows the error.
    }
  },
  { immediate: true },
);

/** Last lines only; the detail view shows all of it. */
const stderrTail = computed(() =>
  attention.value?.kind === "failed" ? attention.value.stderrTail?.trimEnd().split("\n").slice(-6).join("\n") : undefined,
);

/** Retry a draft whose publishing failed. The daemon pushes the item update. */
const retrying = ref(false);
async function retryDraft() {
  const a = attention.value;
  if (a?.kind !== "draft") return;
  retrying.value = true;
  error.value = undefined;
  try {
    await api.approveDraft(a.draftId);
  } catch (e) {
    if (!isPublishFailure(e)) error.value = errorText(e);
  } finally {
    retrying.value = false;
  }
}

const error = ref<string>();
async function act(fn: (id: string) => Promise<void>) {
  error.value = undefined;
  try {
    await fn(props.item.id);
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <article class="card" :class="[`in-${column}`, { muted: noClone, finished }]">
    <div class="meta mono">
      <a
        :href="item.externalUrl"
        target="_blank"
        rel="noreferrer"
        class="ext"
        :title="hideRepo ? displayId(item.externalId) : undefined"
        :aria-label="hideRepo ? displayId(item.externalId) : undefined"
      >{{ hideRepo ? shortId(item.externalId) : displayId(item.externalId) }}</a>
      <span v-if="item.state === 'running'" class="live"><span class="dot dot-ok" aria-hidden="true"></span>running<template v-if="elapsed"> · {{ elapsed }}</template></span>
      <span v-else-if="item.state === 'checking'" class="live"><span class="dot dot-off" aria-hidden="true"></span>waiting for CI</span>
      <span v-else-if="flag" class="flag">{{ flag }}</span>
      <span v-else-if="column === 'needs_you' && !noClone" class="playbook" title="Playbook">{{ item.playbook }}</span>
    </div>
    <h3><RouterLink :to="{ name: 'item', params: { id: item.id } }" class="title">{{ item.title }}</RouterLink></h3>
    <div v-if="item.labels.length" class="labels">
      <span v-for="l in item.labels" :key="l" class="label" :class="`tone-${labelTone(l)}`">{{ l }}</span>
    </div>
    <div v-if="noClone" class="note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle><path d="M12 8v4m0 4h.01"></path>
      </svg>
      No local clone<template v-if="repoRoot"> under {{ repoRoot }}</template>
    </div>
    <div v-if="closedUpstream" class="note warn">
      Closed on GitHub
      <button
        v-if="dismissable"
        class="btn subtle dismiss"
        type="button"
        :disabled="busy"
        title="Move to Done. The worktree stays until you remove it."
        @click="act(dismissItem)"
      >Dismiss</button>
    </div>
    <div v-if="item.state === 'running'" class="activity mono">
      <span v-if="item.branch">{{ item.branch }}</span>
      <span v-if="item.agent.currentTool" class="dim">{{ item.agent.currentTool.name }} · {{ item.agent.currentTool.summary }}</span>
      <span v-else-if="!item.agent.startedAt || !item.worktreePath" class="dim">preparing worktree…</span>
    </div>
    <AskPanel
      v-if="attention?.kind === 'ask'"
      :ask-id="attention.askId"
      :tool-name="attention.toolName"
      :input="attention.input"
      :rules="attention.rules"
      :reason="attention.reason"
      :worktree="item.worktreePath"
      :repo="repoOf(item.externalId)"
    />
    <template v-else-if="attention?.kind === 'draft'">
      <div class="stats mono">
        <template v-if="draftStats">
          <span class="add">+{{ draftStats.additions }}</span> <span class="del">−{{ draftStats.deletions }}</span>
          · {{ draftStats.files }} {{ draftStats.files === 1 ? "file" : "files" }} · {{ draftStats.commits }} {{ draftStats.commits === 1 ? "commit" : "commits" }}
        </template>
        <template v-else>{{ attention.title }}</template>
      </div>
      <p v-if="attention.error" class="reason">{{ attention.error }}</p>
      <div class="actions">
        <button v-if="attention.error" class="btn btn-primary" type="button" :disabled="retrying" @click="retryDraft">
          {{ retrying ? "Publishing…" : "Retry" }}
        </button>
        <RouterLink :to="{ name: 'item', params: { id: item.id } }" class="btn" :class="{ 'btn-amber': !attention.error }">Review draft</RouterLink>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'ci_failed'">
      <ul class="checks mono">
        <li v-for="c in attention.failed" :key="c.name">
          <a v-if="c.link" :href="c.link" target="_blank" rel="noreferrer">{{ c.name }}</a><template v-else>{{ c.name }}</template>
        </li>
      </ul>
      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="busy || !item.agentSessionId" title="Resume the agent with the failed checks and their logs" @click="act(fixCi)">Fix with agent</button>
        <button v-if="attention.runs.length" class="btn" type="button" :disabled="busy" title="gh run rerun --failed" @click="act(rerunCi)">Rerun failed</button>
        <button class="btn subtle" type="button" :disabled="busy" @click="act(markCiDone)">Mark done</button>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'pr_conflict'">
      <p class="reason">
        <a :href="attention.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ attention.pr.number }}</a> has merge conflicts with
        <span class="mono">{{ attention.base }}</span>
      </p>
      <ul v-if="attention.files.length" class="checks mono">
        <li v-for="f in attention.files" :key="f">{{ f }}</li>
      </ul>
      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="busy || !item.agentSessionId" title="Fetch the base and let the agent merge it; it proposes a push draft" @click="act(resolveConflict)">Resolve with agent</button>
        <button class="btn subtle" type="button" :disabled="busy" @click="act(dismissConflict)">I'll do it myself</button>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'failed'">
      <p class="reason">{{ attention.reason }}</p>
      <pre v-if="stderrTail" class="stderr mono">{{ stderrTail }}</pre>
    </template>
    <template v-else-if="attention?.kind === 'resume'">
      <p class="reason">{{ attention.reason }}. The session can continue where it stopped.</p>
      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="busy" @click="act(resumeAgent)">Resume</button>
        <RouterLink :to="{ name: 'agent', params: { id: item.id } }" class="btn">Transcript</RouterLink>
      </div>
    </template>
    <p v-if="item.pr?.conflict && !item.pr.conflict.waiting" class="note quiet">
      <a :href="item.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ item.pr.number }}</a> has merge conflicts with
      <span class="mono">{{ item.pr.conflict.base }}</span>
    </p>
    <p v-else-if="item.pr && merge?.kind === 'pending'" class="note quiet">
      Worktree is removed when <a :href="item.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ item.pr.number }}</a> is merged
    </p>
    <div v-else-if="item.pr && attention?.kind !== 'pr_conflict'" class="pr-line">
      <a :href="item.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ item.pr.number }}</a>
      <span v-if="merge?.kind === 'merged'" class="merged">PR merged</span>
      <span v-else-if="merge?.kind === 'skipped'" class="note warn">Not removed: {{ merge.reason }}</span>
    </div>
    <div v-if="startable" class="actions">
      <label :for="`pb-${item.id}`" class="sr-only">Playbook</label>
      <select :id="`pb-${item.id}`" class="select" :value="item.playbook" disabled title="More playbooks come later">
        <option :value="item.playbook">{{ item.playbook }}</option>
      </select>
      <button class="btn btn-primary" type="button" :disabled="busy" @click="act(startAgent)">
        {{ item.state === "failed" ? "Retry" : "Start" }}
      </button>
    </div>
    <div v-else-if="item.state === 'running' || (item.agent.running && column === 'needs_you' && attention?.kind !== 'draft')" class="actions">
      <RouterLink :to="{ name: 'agent', params: { id: item.id } }" class="btn">Transcript</RouterLink>
      <button v-if="item.agent.running" class="btn stop" type="button" :disabled="busy" @click="act(stopAgent)">Stop</button>
    </div>
    <div v-if="item.state === 'checking'" class="actions">
      <button class="btn subtle" type="button" :disabled="busy" title="Stop waiting for CI and move to Done" @click="act(markCiDone)">Mark done</button>
    </div>
    <div v-if="removable" class="actions">
      <button class="btn subtle" type="button" :disabled="busy" title="git worktree remove; the branch is kept" @click="act(removeWorktree)">Remove worktree</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card.in-in_progress { border-color: var(--blue); }
.card.in-needs_you { background: var(--amber-tint); border-color: var(--amber-border); }
.card.muted { background: var(--card-muted); border: 1px dashed var(--border-control); color: var(--ink-3); }
.card.muted h3, .card.in-done h3 { color: var(--ink-2); }
.card.finished { background: var(--card-muted); border-color: var(--border-soft); color: var(--ink-3); }
.card.finished h3, .card.finished .label { color: var(--ink-3); }
.card.finished .label { background: transparent; border: 1px solid var(--border-soft); }
.meta { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12px; color: var(--ink-3); }
.ext { color: inherit; text-decoration: none; min-width: 0; overflow-wrap: anywhere; }
.ext:hover { color: var(--blue); text-decoration: underline; }
.playbook {
  flex: none;
  font-size: 11px;
  padding: 1px 7px;
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  color: var(--ink-2);
}
.flag { flex: none; color: var(--amber); font-family: var(--sans); font-weight: 500; }
h3 { margin: 0; font-size: 14px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
.title { color: inherit; text-decoration: none; }
.title:hover { color: var(--blue); text-decoration: underline; }
.stats { font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.add { color: #15803d; }
.del { color: var(--danger); }
.pr { font-size: 12px; color: var(--blue); text-decoration: none; }
.pr:hover { text-decoration: underline; }
.reason { margin: 0; font-size: 13px; color: var(--ink-2); overflow-wrap: anywhere; }
.checks { margin: 0; padding-left: 16px; font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.checks a { color: inherit; }
.stderr {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-ink);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 120px;
  overflow: auto;
}
.labels { display: flex; gap: 6px; flex-wrap: wrap; }
.label { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--border-soft); color: var(--ink-2); }
.label.tone-bug { background: var(--danger-tint); color: var(--danger); }
.label.tone-feature { background: var(--blue-tint); color: var(--blue); }
.note { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.note.warn { color: var(--amber); }
.note.quiet { display: block; margin: 0; color: var(--ink-3); }
.pr-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.merged { font-size: 12px; color: var(--ink-3); }
.dismiss { margin-left: auto; height: 26px; padding: 0 10px; font-size: 12px; }
.live { flex: none; display: flex; align-items: center; gap: 6px; color: var(--blue); }
.activity { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.dim { color: var(--ink-3); }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.actions .btn { display: inline-flex; align-items: center; text-decoration: none; }
.select {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border-control);
  border-radius: 6px;
  background: var(--card);
  font: inherit;
  font-size: 13px;
  color: var(--ink);
}
.stop { color: var(--danger); font-weight: 400; }
.subtle { font-weight: 400; color: var(--ink-2); }
.error { margin: 0; padding: 8px 10px; border-radius: 6px; background: var(--danger-tint); color: var(--danger); font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
