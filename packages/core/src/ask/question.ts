import { z } from "zod";

/**
 * Claude Code's `AskUserQuestion` tool. It arrives as a permission ask, but Allow alone is no
 * answer: the CLI then tells the agent "The user did not answer the questions." The answer is an
 * allow whose `updatedInput` is the input plus `answers`, one string per question keyed by the
 * question's text. Several choices are joined with ", "; free text goes in as typed (spec 9.4,
 * recorded in `fixtures/stream/ask-question.jsonl`).
 */
export const QUESTION_TOOL = "AskUserQuestion";

export function isQuestionTool(toolName: string): boolean {
  return toolName === QUESTION_TOOL;
}

const OptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().catch(""),
  /** A mockup or snippet to compare options by, shown in mono. */
  preview: z.string().optional().catch(undefined),
});

const QuestionSchema = z.object({
  question: z.string().min(1),
  header: z.string().catch(""),
  multiSelect: z.boolean().catch(false),
  options: z.array(z.unknown()).catch([]).transform((list) =>
    list.flatMap((o) => {
      const r = OptionSchema.safeParse(o);
      return r.success ? [r.data] : [];
    }),
  ),
});

export type QuestionOption = z.infer<typeof OptionSchema>;
export type Question = z.infer<typeof QuestionSchema>;

/** Answers by question text, as the CLI expects them. */
export type Answers = Record<string, string>;

/**
 * The questions in an `AskUserQuestion` input. A question without text is dropped: there is
 * nothing to file its answer under. One without options is kept; free text answers it.
 */
export function questionsOf(input: unknown): Question[] {
  const list = typeof input === "object" && input !== null ? (input as { questions?: unknown }).questions : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((q) => {
    const r = QuestionSchema.safeParse(q);
    return r.success ? [r.data] : [];
  });
}

/** How several choices on one question are written. */
export function joinChoices(labels: readonly string[]): string {
  return labels.join(", ");
}

/**
 * Check answers against the questions they answer: every question has a non-empty answer and
 * nothing else is answered. Any text counts, because the user may always answer in their own
 * words. Returns the trimmed answers, or throws with what is wrong.
 */
export function checkAnswers(questions: readonly Question[], answers: Answers): Answers {
  if (questions.length === 0) throw new Error("this ask has no questions");
  const known = new Set(questions.map((q) => q.question));
  const extra = Object.keys(answers).find((k) => !known.has(k));
  if (extra !== undefined) throw new Error(`no such question: ${extra}`);
  const checked: Answers = {};
  for (const q of questions) {
    const a = answers[q.question]?.trim();
    if (!a) throw new Error(`no answer for: ${q.question}`);
    checked[q.question] = a;
  }
  return checked;
}

/** The ask's input with the answers written in, ready to be the allow's `updatedInput`. */
export function answeredInput(input: unknown, answers: Answers): Record<string, unknown> {
  const base = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return { ...base, answers };
}
