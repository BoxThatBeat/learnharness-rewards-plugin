import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, weekStart } from "../src/dates.ts";
import { computeStreak, derive, nextMilestones } from "../src/rewards.ts";
import type { SessionFacts } from "../src/scan.ts";

const days = (start: string, count: number) => Array.from({ length: count }, (_, index) => addDays(start, index));

test("week helpers", () => {
  assert.equal(weekStart("2026-11-15"), "2026-11-09"); // Sunday → Monday
  assert.equal(weekStart("2026-11-09"), "2026-11-09");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
});

test("daily streak counts consecutive days and today stays open", () => {
  const active = days("2026-11-01", 5); // 1..5
  const doneToday = computeStreak(active, "daily", 3, "2026-11-05");
  assert.equal(doneToday.current, 5);
  assert.equal(doneToday.todayActive, true);
  assert.equal(doneToday.atRisk, false);
  const notYet = computeStreak(active, "daily", 3, "2026-11-06");
  assert.equal(notYet.current, 5, "yesterday still counts until today ends");
  assert.equal(notYet.atRisk, true);
  assert.deepEqual(notYet.runs, [{ start: "2026-11-01", end: "2026-11-05", frozen: [], length: 5 }]);
});

test("daily freezes are earned every 7 days, spent on a missed day, and do not save a double miss", () => {
  const active = [...days("2026-11-01", 7), ...days("2026-11-09", 3)]; // miss 11-08
  const saved = computeStreak(active, "daily", 3, "2026-11-11");
  assert.equal(saved.current, 10);
  assert.equal(saved.freezes, 0);
  assert.deepEqual(saved.runs[0]!.frozen, ["2026-11-08"]);

  const yesterdayFrozen = computeStreak(days("2026-11-01", 7), "daily", 3, "2026-11-09");
  assert.equal(yesterdayFrozen.current, 7, "a freeze covering yesterday keeps the streak alive");

  const broken = computeStreak([...days("2026-11-01", 7), "2026-11-10"], "daily", 3, "2026-11-10"); // miss 8 and 9
  assert.equal(broken.current, 1);
  assert.equal(broken.longest, 7);
  assert.deepEqual(broken.runs[0], { start: "2026-11-01", end: "2026-11-07", frozen: [], length: 7 });
  assert.equal(broken.reached[7], "2026-11-07");
});

test("weekly streak needs N active days per Mon–Sun week; current week is open", () => {
  // Weeks of 2026-11-02, 11-09 qualify (3 days); week of 11-16 has 1 so far.
  const active = ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-10", "2026-11-11", "2026-11-14", "2026-11-16"];
  const streak = computeStreak(active, "weekly", 3, "2026-11-17");
  assert.equal(streak.current, 2);
  assert.deepEqual(streak.week, { start: "2026-11-16", activeDays: 1, goal: 3, met: false, daysLeft: 6 });
  assert.equal(streak.atRisk, false, "plenty of days left this week");
  assert.equal(computeStreak(active, "weekly", 3, "2026-11-21").atRisk, true, "Saturday with 1 of 3: must study today");
  assert.deepEqual(streak.runs, [{ start: "2026-11-02", end: "2026-11-15", frozen: [], length: 2 }]);
  assert.equal(streak.reached[1], "2026-11-06");
  assert.equal(streak.reached[2], "2026-11-14");

  const lapsed = computeStreak(active, "weekly", 3, "2026-11-30");
  assert.equal(lapsed.current, 0, "a missed week without freezes breaks the streak");
});

test("weekly freezes earned every 4 weeks cover a missed week", () => {
  const qualifying = (monday: string) => [monday, addDays(monday, 1), addDays(monday, 2)];
  const active = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-09"].flatMap(qualifying); // skip week of 11-02
  const streak = computeStreak(active, "weekly", 3, "2026-11-12");
  assert.equal(streak.current, 5);
  assert.equal(streak.runs[0]!.frozen.length, 7);
  assert.equal(streak.runs[0]!.frozen[0], "2026-11-02");
});

const facts = (overrides: Partial<SessionFacts>): SessionFacts => ({
  updatedAt: "", activeDates: [], questionDates: [], correctAnswers: 0, perfectRunDate: null, problemDates: [],
  stars: [], earlyBirdDate: null, nightOwlDate: null, ...overrides,
});

test("derive aggregates sessions into totals, achievements with unlock dates, and milestones", () => {
  const questionDates = days("2026-11-01", 12);
  const derived = derive({
    a: facts({ activeDates: days("2026-11-01", 3), questionDates: questionDates.slice(0, 6), correctAnswers: 6, stars: [...questionDates.slice(0, 6).map((date, index) => ({ date, source: "teacher" as const, id: `t${index}` })), { date: "2026-11-01", source: "quiz" as const, id: "legacy" }], perfectRunDate: "2026-11-02" }),
    b: facts({ activeDates: ["2026-11-04"], questionDates: questionDates.slice(6), problemDates: ["2026-11-04"], earlyBirdDate: "2026-11-04" }),
  }, days("2026-10-01", 12), "daily", 3, "2026-11-04");
  assert.deepEqual(derived.totals, { stars: 6, questions: 12, correct: 6, problems: 1, sessions: 2, concepts: 12, activeDays: 4 });
  const byId = Object.fromEntries(derived.achievements.map(item => [item.id, item]));
  assert.equal(byId["questions-10"]!.unlockedAt, "2026-11-10");
  assert.equal(byId["concepts-10"]!.unlockedAt, "2026-10-10");
  assert.equal(byId["streak-days-3"]!.unlockedAt, "2026-11-03");
  assert.equal(byId["practice-1"]!.unlockedAt, "2026-11-04");
  assert.equal(byId["fun-perfect-run"]!.unlockedAt, "2026-11-02");
  assert.equal(byId["fun-night-owl"]!.unlockedAt, null);
  assert.equal(byId["stars-10"]!.progress, 6, "legacy automatic stars are ignored");
  assert.equal(byId["stars-5"]!.unlockedAt, "2026-11-05");
  assert.equal(derived.starsByDate["2026-11-01"], 1);
  const next = nextMilestones(derived.achievements);
  assert.equal(new Set(next.map(item => item.group)).size, next.length, "one per group");
  assert.ok(derive({}, [], "weekly", 3, "2026-11-04").achievements.some(item => item.id === "streak-weeks-4"));
});
