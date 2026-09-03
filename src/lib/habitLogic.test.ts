import { describe, expect, it } from "vitest";
import {
  calculateCompletion,
  calculateDebt,
  listDaysToClose,
  shouldCreatePenalty
} from "./habitLogic";
import type { DailyEntry, Payment, Penalty } from "../types/domain";

const entries = (doneStates: boolean[]): DailyEntry[] =>
  doneStates.map((isDone, index) => ({
    id: `entry-${index}`,
    personId: "me",
    habitId: `habit-${index}`,
    date: "2026-07-31",
    isDone,
    title: `Habit ${index + 1}`,
    sortOrder: index
  }));

describe("habitLogic", () => {
  it("calculates completion count and percent", () => {
    expect(calculateCompletion(entries([true, false, true]))).toEqual({
      total: 3,
      done: 2,
      percent: 67,
      isComplete: false
    });
  });

  it("treats an empty checklist as complete and not punishable", () => {
    expect(calculateCompletion([])).toEqual({
      total: 0,
      done: 0,
      percent: 100,
      isComplete: true
    });
    expect(shouldCreatePenalty([])).toBe(false);
  });

  it("creates a penalty only when at least one entry is incomplete", () => {
    expect(shouldCreatePenalty(entries([true, true]))).toBe(false);
    expect(shouldCreatePenalty(entries([true, false]))).toBe(true);
  });

  it("calculates debt from penalties minus payments without going below zero", () => {
    const penalties: Penalty[] = [
      { id: "p1", personId: "me", date: "2026-07-30", amount: 20000, reason: "missed_day" },
      { id: "p2", personId: "me", date: "2026-07-31", amount: 20000, reason: "missed_day" }
    ];
    const payments: Payment[] = [
      { id: "pay1", personId: "me", amount: 15000, paidAt: "2026-08-01T08:00:00.000Z", note: "" }
    ];

    expect(calculateDebt(penalties, payments)).toBe(25000);
    expect(calculateDebt(penalties, [{ ...payments[0], amount: 80000 }])).toBe(0);
  });

  it("lists every calendar day before today, including days the app was never opened", () => {
    expect(listDaysToClose("2026-08-30", "2026-09-03")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02"
    ]);
    expect(listDaysToClose("2026-09-03", "2026-09-03")).toEqual([]);
  });
});
