<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { addressFeedback, dismissConflict, dismissFeedback, dismissItem, fixCi, markCiDone, pending, removeWorktree, rerunCi, resolveConflict, resumeAgent, startAgent, stopAgent } from "../agents/actions";
import { api } from "../api/client";
import { errorText, isPublishFailure } from "../api/errors";
import type { ItemView } from "../api/types";
import AskPanel from "../asks/AskPanel.vue";
import CloneButton from "./CloneButton.vue";
import CiPendingDot from "../ci/CiPendingDot.vue";
import { repoOf } from "../markdown/render";
import { diffFiles, diffStats, type DiffStats } from "../diff/files";
import { agentElapsed, clock, money } from "../time/duration";
import { since } from "../time/relative";
import IconAlert from "../icons/IconAlert.vue";
import IconCheck from "../icons/IconCheck.vue";
import IconMerge from "../icons/IconMerge.vue";
import IconPlay from "../icons/IconPlay.vue";
import IconPullRequest from "../icons/IconPullRequest.vue";
import IconShield from "../icons/IconShield.vue";
import IconStop from "../icons/IconStop.vue";
import SourceLink from "../sourcelink/SourceLink.vue";
import { checkBadges } from "../ci/check-badges";
import { cardBadge } from "./card-badge";
import { upsert } from "./items";
import { loadPlaybookEntries, playbookEntries, playbookOptions } from "./playbook-options";
import { columnOf, displayId, shortId } from "./columns";
import { isFinished } from "./finished";
import { mergeNote } from "./merge-note";
import { priorityBadge } from "./priority-badge";
import { prKind } from "./pr-kind";
import PrStatusPanel from "./PrStatusPanel.vue";

/**
 * `hideRepo`: the lane already names the repo, so the id shows only the number.
 * `removeOnMerge`: the user's `removeWorktreeOnMerge` (D33).
 */
const props = defineProps<{ item: ItemView; repoRoot?: string; now: number; hideRepo?: boolean; removeOnMerge?: boolean }>();

const noClone = computed(() => props.item.badges.includes("no-local-clone"));
/** Someone else's pull request, assigned to the user or asking for their review (D40, D47). */
const pr = computed(() => prKind(props.item));
const closedUpstream = computed(() => props.item.badges.includes("closed-upstream"));
const priority = computed(() => priorityBadge(props.item.priority));
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
/** Cost shows on the card (#89); tokens are on the item page. */
const cost = computed(() => (props.item.agent.costUsd ? money(props.item.agent.costUsd) : undefined));
const elapsed = computed(() => {
  const ms = agentElapsed(props.item.agent, props.now);
  return ms === undefined ? undefined : clock(ms);
});

const attention = computed(() => props.item.attention);
/** The one badge in the corner (spec 12.1). */
const badge = computed(() => cardBadge(props.item));
const BADGE_ICONS = { pr: IconPullRequest, merge: IconMerge, shield: IconShield, alert: IconAlert, check: IconCheck };
/** Labels besides the one in the corner. */
const tags = computed(() => props.item.labels.filter((l) => l !== badge.value?.label));
/** Someone else's pull request shows as a tag when the corner says something else. */
const prTag = computed(() => (pr.value && badge.value?.title !== pr.value.title ? pr.value : undefined));
/** How long the card has waited for the user: "waiting 14 min". */
const waiting = computed(() => (column.value === "needs_you" ? `waiting ${since(props.item.stateSince, props.now)}` : undefined));
const checks = computed(() => checkBadges(props.item.ci?.checks ?? [], props.now));
/** "worktree removed" once a started item has none left. */
const worktreeGone = computed(() => props.item.state === "done" && !!props.item.startedAt && !props.item.worktreePath);

/** The playbook a Ready item runs; it can change until the first start. */
const choosable = computed(() => props.item.state === "ready" && !props.item.startedAt && !noClone.value);
const playbooks = computed(() => playbookOptions(playbookEntries.value, props.item.repo?.id, props.item.playbook));
onMounted(() => {
  if (choosable.value) void loadPlaybookEntries();
});
async function choosePlaybook(name: string) {
  error.value = undefined;
  try {
    upsert(await api.setPlaybook(props.item.id, name));
  } catch (e) {
    error.value = errorText(e);
  }
}

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

const feedbackAuthors = computed(() =>
  attention.value?.kind === "pr_feedback" ? [...new Set(attention.value.entries.map((e) => `@${e.author}`))].join(", ") : "",
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
  <article class="card item" :class="{ running: item.state === 'running', attn: column === 'needs_you' && !noClone, ghost: noClone || (closedUpstream && item.state !== 'done'), done: column === 'done', finished }">
    <div class="meta">
      <SourceLink
        :source="item.source"
        :url="item.externalUrl"
        :label="displayId(item.externalId)"
        class="ext"
        :aria-label="hideRepo ? displayId(item.externalId) : undefined"
      >{{ hideRepo ? shortId(item.externalId) : displayId(item.externalId) }}</SourceLink>
      <span v-if="item.state === 'running'" class="live primary"><span class="dot primary" aria-hidden="true"></span>running<template v-if="elapsed"> · {{ elapsed }}</template></span>
      <span v-else-if="item.state === 'checking'" class="live attn"><CiPendingDot />waiting for CI</span>
      <span v-else-if="badge" class="badge" :class="badge.tone" :title="badge.title">
        <component :is="BADGE_ICONS[badge.icon]" v-if="badge.icon" class="ic-sm" />{{ badge.text }}
      </span>
    </div>
    <h3><RouterLink :to="{ name: 'item', params: { id: item.id } }" class="title">{{ item.title }}</RouterLink></h3>
    <div v-if="tags.length || priority || prTag" class="tags">
      <span v-if="prTag" class="badge primary" :title="prTag.title">{{ prTag.text }}</span>
      <span v-for="l in tags" :key="l" class="badge">{{ l }}</span>
      <span v-if="priority" class="badge" :class="priority.tone === 'urgent' ? 'danger' : 'muted'" :title="priority.title">{{ priority.text }}</span>
    </div>
    <div v-if="noClone" class="note">
      <IconAlert class="ic-sm" />
      No local clone<template v-if="repoRoot"> under {{ repoRoot }}</template>
      <CloneButton v-if="item.clone" :clone="item.clone" />
    </div>
    <div v-if="closedUpstream" class="note">
      Closed on GitHub
      <button
        v-if="dismissable"
        class="btn ghost sm dismiss"
        type="button"
        :disabled="busy"
        title="Move to Done. The worktree stays until you remove it."
        @click="act(dismissItem)"
      >Dismiss</button>
    </div>
    <PrStatusPanel v-if="pr && !finished" :item="item" />
    <div v-if="item.state === 'running'" class="activity mono">
      <span v-if="item.branch">{{ item.branch }}</span>
      <span v-if="item.agent.currentTool">{{ item.agent.currentTool.name }} · {{ item.agent.currentTool.summary }}</span>
      <span v-else-if="!item.agent.startedAt || !item.worktreePath">preparing worktree…</span>
    </div>
    <div v-if="item.state === 'checking' && checks.length" class="checkrow">
      <span v-for="c in checks" :key="c.name" class="badge" :class="c.tone"><IconCheck v-if="c.passed" class="ic-sm" />{{ c.text }}</span>
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
      compact
    />
    <template v-else-if="attention?.kind === 'draft'">
      <div class="stats mono">
        <template v-if="draftStats">
          <span class="add">+{{ draftStats.additions }}</span> <span class="del">−{{ draftStats.deletions }}</span>
          · {{ draftStats.files }} {{ draftStats.files === 1 ? "file" : "files" }} · {{ draftStats.commits }} {{ draftStats.commits === 1 ? "commit" : "commits" }}
        </template>
        <template v-else>{{ attention.title }}</template>
        <template v-if="waiting && !attention.executing"> · {{ waiting }}</template>
      </div>
      <p v-if="attention.error" class="reason">{{ attention.error }}</p>
      <div class="acts">
        <button v-if="attention.error" class="btn primary" type="button" :disabled="retrying" @click="retryDraft">
          {{ retrying ? "Publishing…" : "Retry" }}
        </button>
        <RouterLink :to="{ name: 'item', params: { id: item.id } }" class="btn" :class="{ attn: !attention.error }">Review draft</RouterLink>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'ci_failed'">
      <div class="checkrow">
        <template v-for="c in attention.failed" :key="c.name">
          <a v-if="c.link" :href="c.link" target="_blank" rel="noreferrer" class="badge danger link">{{ c.name }}</a>
          <span v-else class="badge danger">{{ c.name }}</span>
        </template>
      </div>
      <div class="acts wrap">
        <button class="btn sm primary" type="button" :disabled="busy || !item.agentSessionId" title="Resume the agent with the failed checks and their logs" @click="act(fixCi)">Fix with agent</button>
        <button v-if="attention.runs.length" class="btn sm" type="button" :disabled="busy" title="gh run rerun --failed" @click="act(rerunCi)">Rerun failed</button>
        <button class="btn sm ghost" type="button" :disabled="busy" @click="act(markCiDone)">Mark done</button>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'pr_conflict'">
      <p class="reason">
        PR #{{ attention.pr.number }} conflicts with <span class="inline-code">{{ attention.base }}</span><template v-if="attention.files.length">
          in {{ attention.files.length }} {{ attention.files.length === 1 ? "file" : "files" }}</template>. Who resolves it?
      </p>
      <ul v-if="attention.files.length" class="files mono">
        <li v-for="f in attention.files" :key="f">{{ f }}</li>
      </ul>
      <div class="acts">
        <button class="btn sm primary" type="button" :disabled="busy || !item.agentSessionId" title="Fetch the base and let the agent merge it; it proposes a push draft" @click="act(resolveConflict)">Agent</button>
        <button class="btn sm" type="button" :disabled="busy" title="Take it on yourself; the card leaves Needs You" @click="act(dismissConflict)">I'll do it</button>
        <a :href="attention.pr.url" target="_blank" rel="noreferrer" class="pr mono end">PR ↗</a>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'pr_feedback'">
      <p class="reason">PR #{{ attention.pr.number }} has review feedback from {{ feedbackAuthors }}</p>
      <div class="acts wrap">
        <button class="btn sm primary" type="button" :disabled="busy || !item.agentSessionId" title="Resume the agent with the comments; it proposes a push or reply draft" @click="act(addressFeedback)">Address with agent</button>
        <RouterLink :to="{ name: 'item', params: { id: item.id } }" class="btn sm">Read</RouterLink>
        <button class="btn sm ghost" type="button" :disabled="busy" @click="act(dismissFeedback)">Mark done</button>
        <a :href="attention.pr.url" target="_blank" rel="noreferrer" class="pr mono end">PR ↗</a>
      </div>
    </template>
    <template v-else-if="attention?.kind === 'failed'">
      <p class="reason">{{ attention.reason }}</p>
      <pre v-if="stderrTail" class="code stderr">{{ stderrTail }}</pre>
    </template>
    <template v-else-if="attention?.kind === 'resume'">
      <p class="reason">{{ attention.reason }}. The session can continue where it stopped.</p>
      <div class="acts">
        <button class="btn sm primary" type="button" :disabled="busy" @click="act(resumeAgent)"><IconPlay class="ic-sm" />Resume</button>
        <RouterLink :to="{ name: 'agent', params: { id: item.id } }" class="btn sm">Transcript</RouterLink>
      </div>
    </template>
    <p v-if="item.pr?.conflict && !item.pr.conflict.waiting" class="note quiet">
      <a :href="item.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ item.pr.number }} ↗</a> has merge conflicts with
      <span class="inline-code">{{ item.pr.conflict.base }}</span>
    </p>
    <p v-else-if="item.pr && merge?.kind === 'pending'" class="note quiet">
      Worktree is removed when <a :href="item.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ item.pr.number }} ↗</a> is merged
    </p>
    <div v-else-if="item.pr && attention?.kind !== 'pr_conflict' && attention?.kind !== 'pr_feedback'" class="foot">
      <a :href="item.pr.url" target="_blank" rel="noreferrer" class="pr mono">PR #{{ item.pr.number }} ↗</a>
      <span v-if="merge?.kind === 'skipped'" class="warn">Not removed: {{ merge.reason }}</span>
      <span v-else-if="column === 'done' && (worktreeGone || cost)" class="dim">
        <template v-if="worktreeGone">worktree removed</template><template v-if="worktreeGone && cost"> · </template>{{ cost }}
      </span>
    </div>
    <div v-else-if="column === 'done' && (worktreeGone || cost)" class="foot">
      <span></span>
      <span class="dim"><template v-if="worktreeGone">worktree removed</template><template v-if="worktreeGone && cost"> · </template>{{ cost }}</span>
    </div>
    <div v-if="startable" class="acts">
      <label :for="`pb-${item.id}`" class="sr">Playbook</label>
      <select
        :id="`pb-${item.id}`"
        class="select"
        :value="item.playbook"
        :disabled="!choosable || busy"
        :title="choosable ? 'Playbook' : 'The playbook is fixed once the agent started'"
        @change="choosePlaybook(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="p in playbooks" :key="p.name" :value="p.name">{{ p.label }}</option>
      </select>
      <button class="btn primary" type="button" :disabled="busy" @click="act(startAgent)">
        <IconPlay class="ic-sm" />{{ item.state === "failed" ? "Retry" : "Start" }}
      </button>
    </div>
    <div v-else-if="item.state === 'running' || (item.agent.running && column === 'needs_you' && attention?.kind !== 'draft')" class="acts">
      <RouterLink :to="{ name: 'agent', params: { id: item.id } }" class="btn sm">Transcript</RouterLink>
      <button v-if="item.agent.running" class="btn sm danger" type="button" :disabled="busy" @click="act(stopAgent)"><IconStop class="ic-sm" />Stop</button>
      <span v-if="cost" class="mono dim end">{{ cost }}</span>
    </div>
    <div v-if="item.state === 'checking'" class="acts">
      <button class="btn sm ghost" type="button" :disabled="busy" title="Stop waiting for CI and move to Done" @click="act(markCiDone)">Mark done</button>
    </div>
    <div v-if="removable" class="acts">
      <button class="btn sm ghost" type="button" :disabled="busy" title="git worktree remove; the branch is kept" @click="act(removeWorktree)">Remove worktree</button>
    </div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.item { padding: 13px 14px; display: flex; flex-direction: column; gap: 9px; min-width: 0; }
.item.running { border-color: var(--primary-ring); }
.item.attn { border-color: var(--attn-border); background: var(--attn-tint); }
.item.ghost { border-style: dashed; box-shadow: none; background: transparent; color: var(--fg-3); }
.item.ghost h3, .item.done h3 { color: var(--fg-2); }
.item.finished { box-shadow: none; background: var(--muted); color: var(--fg-3); }
.item.finished h3 { color: var(--fg-3); }
.meta { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-family: var(--mono); font-size: 12px; color: var(--fg-3); }
.meta .badge { font-family: var(--sans); }
.ext { color: inherit; text-decoration: none; min-width: 0; overflow-wrap: anywhere; }
.ext:hover { color: var(--primary); text-decoration: underline; }
.live { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.live.primary { color: var(--primary); }
.live.attn { color: var(--attn); }
h3 { margin: 0; font-size: 14px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
.title { color: inherit; text-decoration: none; }
.title:hover { color: var(--primary); text-decoration: underline; }
.tags, .checkrow { display: flex; gap: 5px; flex-wrap: wrap; }
.badge.link { text-decoration: none; }
.badge.link:hover { text-decoration: underline; }
.stats { color: var(--fg-3); overflow-wrap: anywhere; }
.add { color: var(--ok); }
.del { color: var(--danger); }
.pr { color: var(--primary); text-decoration: none; }
.pr:hover { text-decoration: underline; }
.reason { margin: 0; font-size: 13px; color: var(--fg-2); overflow-wrap: anywhere; }
.files { margin: 0; padding-left: 16px; color: var(--fg-2); overflow-wrap: anywhere; }
.stderr { margin: 0; font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 120px; overflow: auto; }
.note { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; }
.note.quiet { display: block; margin: 0; color: var(--fg-3); }
.dismiss { margin-left: auto; }
.activity { display: flex; flex-direction: column; gap: 3px; color: var(--fg-3); overflow-wrap: anywhere; }
.foot { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.dim { color: var(--fg-3); }
.warn { color: var(--attn); }
.acts { display: flex; gap: 8px; align-items: center; margin-top: 2px; min-width: 0; }
.acts.wrap { flex-wrap: wrap; }
.acts .select { flex: 1; min-width: 0; }
.acts .btn { text-decoration: none; }
.end { margin-left: auto; }
</style>
