import { describe, expect, it } from "vitest";
import { answeredInput, checkAnswers, isQuestionTool, joinChoices, questionsOf } from "./question.js";

const input = {
  questions: [
    { question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue" }] },
    { question: "Which sizes?", header: "Sizes", multiSelect: true, options: [{ label: "S", description: "" }, { label: "" }, "junk"] },
    { header: "No text" },
    { question: "Anything else?" },
  ],
};

describe("AskUserQuestion", () => {
  it("knows the tool", () => {
    expect(isQuestionTool("AskUserQuestion")).toBe(true);
    expect(isQuestionTool("Bash")).toBe(false);
  });

  it("reads the questions, dropping what cannot be answered", () => {
    expect(questionsOf(input)).toEqual([
      { question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "" }] },
      { question: "Which sizes?", header: "Sizes", multiSelect: true, options: [{ label: "S", description: "" }] },
      { question: "Anything else?", header: "", multiSelect: false, options: [] },
    ]);
    expect(questionsOf({})).toEqual([]);
    expect(questionsOf(null)).toEqual([]);
    expect(questionsOf({ questions: "x" })).toEqual([]);
  });

  it("accepts an answer for every question, trimmed, in any words", () => {
    const qs = questionsOf(input);
    expect(checkAnswers(qs, { "Which color?": " Blue ", "Which sizes?": joinChoices(["S", "XL"]), "Anything else?": "No" })).toEqual({
      "Which color?": "Blue", "Which sizes?": "S, XL", "Anything else?": "No",
    });
  });

  it("refuses missing, empty and unknown answers", () => {
    const qs = questionsOf(input);
    expect(() => checkAnswers(qs, { "Which color?": "Red", "Which sizes?": "S" })).toThrow("no answer for: Anything else?");
    expect(() => checkAnswers(qs, { "Which color?": "  ", "Which sizes?": "S", "Anything else?": "x" })).toThrow("no answer for: Which color?");
    expect(() => checkAnswers(qs, { "Which color?": "Red", "Which sizes?": "S", "Anything else?": "x", Other: "y" })).toThrow("no such question: Other");
    expect(() => checkAnswers([], {})).toThrow("no questions");
  });

  it("writes the answers into the input", () => {
    expect(answeredInput(input, { a: "b" })).toEqual({ ...input, answers: { a: "b" } });
    expect(answeredInput(null, { a: "b" })).toEqual({ answers: { a: "b" } });
  });
});
