import { describe, expect, it } from "vitest";
import type { Question } from "@donepm/core";
import { answerOf, answersOf, emptyChoice, isComplete, pick, pickOther } from "./questions";

const color: Question = {
  question: "Which color?", header: "Color", multiSelect: false,
  options: [{ label: "Red", description: "" }, { label: "Green", description: "" }, { label: "Blue", description: "" }],
};
const sizes: Question = {
  question: "Which sizes?", header: "Sizes", multiSelect: true,
  options: [{ label: "Small", description: "" }, { label: "Medium", description: "" }, { label: "Large", description: "" }],
};

describe("question choices", () => {
  it("keeps one option on a single-select question", () => {
    let c = pick(color, emptyChoice(), "Red");
    c = pick(color, c, "Green");
    expect(answerOf(color, c)).toBe("Green");
  });

  it("toggles options on a multi-select question and lists them in the agent's order", () => {
    let c = pick(sizes, emptyChoice(), "Large");
    c = pick(sizes, c, "Small");
    c = pick(sizes, c, "Medium");
    c = pick(sizes, c, "Medium");
    expect(answerOf(sizes, c)).toBe("Small, Large");
  });

  it("lets typed text win, and only while Other is chosen", () => {
    let c = pick(color, emptyChoice(), "Red");
    c = { ...pickOther(color, c), text: "  teal  " };
    expect(c.picked).toEqual([]);
    expect(answerOf(color, c)).toBe("teal");
    c = pick(color, c, "Blue");
    expect(answerOf(color, c)).toBe("Blue");

    let m = { ...pickOther(sizes, pick(sizes, emptyChoice(), "Small")), text: "XXL" };
    expect(answerOf(sizes, m)).toBe("XXL");
    m = { ...pickOther(sizes, m) };
    expect(answerOf(sizes, m)).toBe("Small");
  });

  it("does not count Other without text", () => {
    expect(answerOf(color, pickOther(color, emptyChoice()))).toBe("");
  });

  it("collects answers and knows when every question has one", () => {
    const choices = [pick(color, emptyChoice(), "Green"), emptyChoice()];
    expect(answersOf([color, sizes], choices)).toEqual({ "Which color?": "Green" });
    expect(isComplete([color, sizes], choices)).toBe(false);
    choices[1] = pick(sizes, choices[1]!, "Large");
    expect(answersOf([color, sizes], choices)).toEqual({ "Which color?": "Green", "Which sizes?": "Large" });
    expect(isComplete([color, sizes], choices)).toBe(true);
    expect(isComplete([], [])).toBe(false);
  });
});
