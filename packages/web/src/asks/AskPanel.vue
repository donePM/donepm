<script setup lang="ts">
import { isQuestionTool, questionsOf, type Answers } from "@donepm/core";
import { computed, ref } from "vue";
import { api } from "../api/client";
import { errorText } from "../api/errors";
import type { PermissionRule } from "../api/types";
import type { RepoRef } from "../markdown/render";
import AskInput from "./AskInput.vue";
import { grantText, grantWords } from "./grant";
import QuestionDialog from "./QuestionDialog.vue";
import { askReason } from "./view";

const props = defineProps<{
  askId: string;
  toolName: string;
  input: unknown;
  rules?: PermissionRule[];
  /** The CLI's `decision_reason`. */
  reason?: string;
  /** The item's worktree: a Bash cwd there goes without saying. */
  worktree?: string;
  /** The item's repository: "Always allow" grants the rules there (D38). */
  repo?: RepoRef;
}>();
const emit = defineEmits<{ answered: [] }>();

const reasonText = computed(() => askReason(props.reason));

/** The Bash sandbox asks before any connection (D27); say so in words. */
const network = computed(() => props.toolName === "SandboxNetworkAccess");
const label = computed(() => (network.value ? "Network access" : props.toolName));

/** What "Allow for this run" adds; no button when the CLI suggested nothing we may grant. */
const grant = computed(() => grantText(props.rules ?? []));
/** The same rules, shown under the buttons before the user presses (issue #71). */
const grantShown = computed(() => grantWords(props.rules ?? []));
/** `owner/repo` for "Always allow in …"; no button without a repository. */
const repoName = computed(() => (props.repo ? `${props.repo.owner}/${props.repo.name}` : undefined));

/** AskUserQuestion: Allow alone is no answer; the user answers in a dialog or declines (spec 9.4). */
const questions = computed(() => (isQuestionTool(props.toolName) ? questionsOf(props.input) : []));
const asking = ref(false);

const denying = ref(false);
const message = ref("");
const busy = ref(false);
const error = ref<string>();

async function answer(behavior: "allow" | "deny", scope?: "run" | "always", answers?: Answers, interrupt = false) {
  busy.value = true;
  error.value = undefined;
  try {
    const msg = message.value.trim();
    await api.answer(
      props.askId,
      behavior === "allow"
        ? { behavior, ...(scope ? { scope } : {}), ...(answers ? { answers } : {}) }
        : { behavior, ...(msg ? { message: msg } : {}), ...(interrupt ? { interrupt } : {}) },
    );
    asking.value = false;
    emit("answered");
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ask">
    <ul v-if="questions.length" class="questions">
      <li v-for="q in questions" :key="q.question">
        <span v-if="q.header" class="chip">{{ q.header }}</span>
        {{ q.question }}
      </li>
    </ul>
    <template v-else>
      <p class="head"><span class="tool mono">{{ label }}</span><span v-if="reasonText" class="reason">{{ reasonText }}</span></p>
      <AskInput :tool-name="toolName" :input="input" :worktree="worktree" />
    </template>
    <p v-if="network" class="hint">
      A command wants to connect to this host. Publishing goes through drafts; allow only what the work needs.
    </p>
    <form v-if="denying" class="deny" @submit.prevent="answer('deny')">
      <label class="sr-only" :for="`deny-${askId}`">Message to the agent</label>
      <textarea :id="`deny-${askId}`" v-model="message" class="textarea" rows="2" placeholder="The agent reads this."></textarea>
      <div class="buttons">
        <button class="btn btn-danger" type="submit" :disabled="busy">{{ questions.length ? "Decline" : "Deny" }}</button>
        <button v-if="!questions.length" class="btn btn-danger" type="button" :disabled="busy" title="Ends the agent's turn; you write the next message" @click="answer('deny', undefined, undefined, true)">Deny and stop</button>
        <button class="btn" type="button" :disabled="busy" @click="denying = false">Cancel</button>
      </div>
    </form>
    <div v-else-if="questions.length" class="buttons">
      <button class="btn btn-primary" type="button" :disabled="busy" @click="asking = true">Answer…</button>
      <button class="btn" type="button" :disabled="busy" @click="denying = true">Decline…</button>
    </div>
    <div v-else class="buttons">
      <button class="btn btn-primary" type="button" :disabled="busy" @click="answer('allow')">Allow</button>
      <button v-if="grant" class="btn" type="button" :disabled="busy" :title="`Also allows ${grant} until this run ends`" @click="answer('allow', 'run')">
        Allow for this run
      </button>
      <button
        v-if="grant && repoName"
        class="btn"
        type="button"
        :disabled="busy"
        :title="`Allows ${grant} in every run in ${repoName}, until you remove it in Settings`"
        @click="answer('allow', 'always')"
      >
        Always allow in {{ repoName }}
      </button>
      <button class="btn" type="button" :disabled="busy" @click="answer('deny')">Deny</button>
      <button class="btn" type="button" :disabled="busy" @click="denying = true">Deny and say why…</button>
    </div>
    <p v-if="grantShown.length && !denying && !questions.length" class="hint grant">
      "Allow for this run" also allows
      <template v-for="(w, i) in grantShown" :key="i"
        >{{ i ? ", " : " " }}{{ w.text }}<template v-if="w.pattern"> <code class="mono">{{ w.pattern }}</code></template></template
      > for the rest of this run<template v-if="repoName">; "Always allow" in every run in {{ repoName }}, until you remove it in Settings</template>.
    </p>
    <p v-if="error && !asking" class="alert" role="alert">{{ error }}</p>
    <QuestionDialog
      v-if="asking"
      :ask-id="askId"
      :questions="questions"
      :busy="busy"
      :error="error"
      @send="(a) => answer('allow', undefined, a)"
      @close="asking = false"
    />
  </div>
</template>

<style scoped>
.ask { display: flex; flex-direction: column; gap: 10px; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin: 0; }
.tool { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.reason { font-size: 12px; color: var(--muted, #6b6b63); }
.questions { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; line-height: 1.4; }
.chip { margin-right: 6px; padding: 1px 7px; border-radius: 999px; background: var(--blue-tint); color: var(--blue); font-size: 12px; font-weight: 500; }
.deny { display: flex; flex-direction: column; gap: 8px; }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.hint { margin: 0; font-size: 12px; color: var(--muted, #6b6b63); }
.grant code { padding: 0 4px; border-radius: 4px; background: var(--card-muted); border: 1px solid var(--border-soft); color: var(--ink-2); overflow-wrap: anywhere; }
</style>
