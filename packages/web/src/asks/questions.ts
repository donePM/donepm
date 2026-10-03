import { joinChoices, type Answers, type Question } from "@donepm/core";

/**
 * What the user has chosen on one question so far. "Other" is always offered: the agent's options
 * are suggestions, the user may answer in their own words (spec 9.4).
 */
export interface Choice {
  picked: string[];
  other: boolean;
  text: string;
}

export const emptyChoice = (): Choice => ({ picked: [], other: false, text: "" });

/** Pick an option. A single-select question keeps one answer; a multi-select one toggles. */
export function pick(q: Question, c: Choice, label: string): Choice {
  if (!q.multiSelect) return { ...c, picked: [label], other: false };
  const picked = c.picked.includes(label) ? c.picked.filter((l) => l !== label) : [...c.picked, label];
  return { ...c, picked };
}

/** Choose "Other". On a single-select question it replaces the picked option. */
export function pickOther(q: Question, c: Choice): Choice {
  if (!q.multiSelect) return { ...c, picked: [], other: true };
  return { ...c, other: !c.other };
}

/**
 * The answer as the CLI expects it. Typed text wins over ticked options; ticked options come in the
 * order the agent listed them. Empty when nothing is chosen yet.
 */
export function answerOf(q: Question, c: Choice): string {
  const text = c.text.trim();
  if (c.other && text) return text;
  return joinChoices(q.options.map((o) => o.label).filter((l) => c.picked.includes(l)));
}

/** Answers by question text, leaving out questions without one. */
export function answersOf(questions: readonly Question[], choices: readonly Choice[]): Answers {
  const answers: Answers = {};
  questions.forEach((q, i) => {
    const a = answerOf(q, choices[i] ?? emptyChoice());
    if (a) answers[q.question] = a;
  });
  return answers;
}

/** Every question has an answer: the dialog may send. */
export function isComplete(questions: readonly Question[], choices: readonly Choice[]): boolean {
  return questions.length > 0 && questions.every((q, i) => answerOf(q, choices[i] ?? emptyChoice()) !== "");
}
