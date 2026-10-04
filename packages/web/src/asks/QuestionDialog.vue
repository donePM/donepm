<script setup lang="ts">
import type { Answers, Question } from "@donepm/core";
import { computed, onMounted, ref } from "vue";
import { answerOf, answersOf, emptyChoice, isComplete, pick, pickOther, type Choice } from "./questions";

const props = defineProps<{ askId: string; questions: Question[]; busy?: boolean; error?: string }>();
const emit = defineEmits<{ send: [answers: Answers]; close: [] }>();

const dialog = ref<HTMLDialogElement>();
onMounted(() => dialog.value?.showModal());

const choices = ref<Choice[]>(props.questions.map(emptyChoice));
/** One step per question, then a summary when there is more than one. */
const step = ref(0);
const count = computed(() => props.questions.length);
const summary = computed(() => count.value > 1 && step.value === count.value);
const q = computed(() => props.questions[step.value]);
const choice = computed(() => choices.value[step.value] ?? emptyChoice());
const answered = computed(() => (q.value ? answerOf(q.value, choice.value) !== "" : false));
const last = computed(() => step.value === count.value - 1);

function set(c: Choice) {
  choices.value[step.value] = c;
}

function next() {
  if (!answered.value) return;
  if (last.value && count.value === 1) send();
  else step.value += 1;
}

function send() {
  if (isComplete(props.questions, choices.value)) emit("send", answersOf(props.questions, choices.value));
}

const name = (i: number) => `q-${props.askId}-${i}`;
</script>

<template>
  <dialog ref="dialog" class="dialog" :aria-labelledby="`${name(step)}-title`" @cancel.prevent="emit('close')">
    <form class="body" @submit.prevent="summary ? send() : next()">
      <template v-if="summary">
        <h2 :id="`${name(step)}-title`">Your answers</h2>
        <dl class="summary">
          <template v-for="(sq, i) in questions" :key="sq.question">
            <dt>{{ sq.question }}</dt>
            <dd>
              <button class="link" type="button" @click="step = i">{{ answerOf(sq, choices[i]!) }}</button>
            </dd>
          </template>
        </dl>
      </template>
      <template v-else-if="q">
        <div class="top">
          <span v-if="q.header" class="chip">{{ q.header }}</span>
          <span v-if="count > 1" class="count">{{ step + 1 }} of {{ count }}</span>
        </div>
        <h2 :id="`${name(step)}-title`">{{ q.question }}</h2>
        <p v-if="q.multiSelect" class="hint">Choose any.</p>
        <fieldset class="options">
          <legend class="sr">{{ q.question }}</legend>
          <label v-for="o in q.options" :key="o.label" class="option" :class="{ on: choice.picked.includes(o.label) }">
            <input
              :type="q.multiSelect ? 'checkbox' : 'radio'"
              :name="name(step)"
              :checked="choice.picked.includes(o.label)"
              @change="set(pick(q, choice, o.label))"
            />
            <span class="text">
              <span class="label">{{ o.label }}</span>
              <span v-if="o.description" class="desc">{{ o.description }}</span>
              <pre v-if="o.preview" class="preview mono">{{ o.preview }}</pre>
            </span>
          </label>
          <label class="option" :class="{ on: choice.other }">
            <input :type="q.multiSelect ? 'checkbox' : 'radio'" :name="name(step)" :checked="choice.other" @change="set(pickOther(q, choice))" />
            <span class="text"><span class="label">Other</span></span>
          </label>
          <textarea
            v-if="choice.other"
            class="textarea"
            rows="2"
            :value="choice.text"
            placeholder="Your answer, in your words"
            aria-label="Your answer"
            @input="set({ ...choice, text: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>
        </fieldset>
      </template>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <div class="buttons">
        <button class="btn" type="button" :disabled="busy" @click="emit('close')">Cancel</button>
        <span class="grow"></span>
        <button v-if="step > 0" class="btn" type="button" :disabled="busy" @click="step -= 1">Back</button>
        <button v-if="summary" class="btn primary" type="submit" :disabled="busy || !isComplete(questions, choices)">Send answers</button>
        <button v-else class="btn primary" type="submit" :disabled="busy || !answered">
          {{ count === 1 ? "Send answer" : last ? "Review" : "Next" }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.dialog { width: min(560px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--fg); }
.dialog::backdrop { background: var(--backdrop); }
.body { display: flex; flex-direction: column; gap: 12px; padding: 20px; }
.top { display: flex; align-items: center; gap: 8px; }
.chip { padding: 2px 8px; border-radius: 999px; background: var(--primary-tint); color: var(--primary); font-size: 12px; font-weight: 500; }
.count { margin-left: auto; font-size: 12px; color: var(--fg-3); }
h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.hint { margin: -6px 0 0; font-size: 12px; color: var(--fg-3); }
.options { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: 0; max-height: 50vh; overflow: auto; }
.option { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.option.on { border-color: var(--primary); background: var(--primary-tint); }
.option input { margin-top: 3px; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.label { font-weight: 500; }
.desc { font-size: 13px; color: var(--fg-2); }
.preview { margin: 6px 0 0; padding: 8px 10px; border-radius: 6px; background: var(--code-bg); color: var(--code-fg); font-size: 12px; white-space: pre; overflow: auto; }
.summary { display: grid; grid-template-columns: 1fr; gap: 4px; margin: 0; }
.summary dt { color: var(--fg-2); font-size: 13px; }
.summary dd { margin: 0 0 8px; }
.link { padding: 0; border: 0; background: none; color: var(--primary); font: inherit; font-weight: 500; cursor: pointer; text-align: left; }
.buttons { display: flex; gap: 8px; }
.grow { flex: 1; }
</style>
