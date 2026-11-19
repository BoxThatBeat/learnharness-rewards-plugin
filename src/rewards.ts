/** Pure streak and achievement math over scanned facts. */
import { addDays, daysBetween, weekStart } from "./dates.ts";
import type { SessionFacts, StarEvent } from "./scan.ts";

export type StreakMode = "daily" | "weekly";
export const MAX_FREEZES = 2;
export const FREEZE_EVERY = { daily: 7, weekly: 4 } as const;

export type StreakRun = { start: string; end: string; frozen: string[]; length: number };
export type Streak = {
  mode: StreakMode;
  current: number;
  longest: number;
  freezes: number;
  todayActive: boolean;
  /** The current streak (or a fresh one) needs activity today. */
  atRisk: boolean;
  week: { start: string; activeDays: number; goal: number; met: boolean; daysLeft: number };
  runs: StreakRun[];
  /** First date each streak length was reached, for milestone unlock dates. */
  reached: Record<number, string>;
};

/** Daily or weekly streak with automatically spent, earned freezes. The open period
 * (today, or the current week) never breaks a streak. */
export function computeStreak(activeDates: Iterable<string>, mode: StreakMode, weeklyGoal: number, today: string): Streak {
  const active = new Set(activeDates);
  const sorted = [...active].filter(date => date <= today).sort();
  const thisWeek = weekStart(today);
  const weekActive = sorted.filter(date => date >= thisWeek).length;
  const daysLeft = daysBetween(today, addDays(thisWeek, 6)) + 1;
  const week = { start: thisWeek, activeDays: weekActive, goal: weeklyGoal, met: weekActive >= weeklyGoal, daysLeft };
  const todayActive = active.has(today);
  const runs: StreakRun[] = [];
  const reached: Record<number, string> = {};
  let freezes = 0;
  let current: StreakRun | null = null;
  let earned = 0;

  const extend = (run: StreakRun, date: string) => {
    run.length++;
    reached[run.length] ??= date;
    earned++;
    if (earned % FREEZE_EVERY[mode] === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
  };
  const close = () => {
    if (!current) return;
    // Freezes spent just before a break did not save the streak: trim them off.
    current.frozen = current.frozen.filter(date => date <= current!.end);
    runs.push(current);
    current = null;
    earned = 0;
  };

  if (sorted.length) {
    if (mode === "daily") {
      for (let date = sorted[0]!; date <= today; date = addDays(date, 1)) {
        if (active.has(date)) {
          current ??= { start: date, end: date, frozen: [], length: 0 };
          current.end = date;
          extend(current, date);
        } else if (date === today) {
          break; // Open period.
        } else if (current && freezes > 0) {
          freezes--;
          current.frozen.push(date);
        } else close();
      }
    } else {
      for (let start = weekStart(sorted[0]!); start <= thisWeek; start = addDays(start, 7)) {
        const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
        const count = days.filter(date => active.has(date)).length;
        const qualifiedOn = count >= weeklyGoal ? days.filter(date => active.has(date))[weeklyGoal - 1]! : null;
        if (qualifiedOn) {
          current ??= { start, end: start, frozen: [], length: 0 };
          current.end = addDays(start, 6);
          extend(current, qualifiedOn);
        } else if (start === thisWeek) {
          break;
        } else if (current && freezes > 0) {
          freezes--;
          current.frozen.push(...days);
        } else close();
      }
    }
  }
  const open = current as StreakRun | null;
  if (open) runs.push(open);
  // A run is still alive if it reaches the previous period (or includes the current one).
  const lastAlive = mode === "daily" ? addDays(today, -1) : addDays(thisWeek, -1);
  const reach = open ? [open.end, ...open.frozen].sort().at(-1)! : "";
  const alive = open && reach >= lastAlive ? open : null;
  const count = alive?.length ?? 0;
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const atRisk = mode === "daily"
    ? !todayActive
    : !week.met && !todayActive && weeklyGoal - weekActive >= daysLeft;
  return { mode, current: count, longest, freezes, todayActive, atRisk, week, runs, reached };
}

// ---- Achievements ----

export type Group = "concepts" | "streak" | "stars" | "questions" | "practice" | "sessions" | "fun";
export type AchievementDef = { id: string; group: Group; title: string; description: string; icon: string; threshold: number };
export type Achievement = AchievementDef & { progress: number; unlockedAt: string | null };

const tiers = (group: Group, icon: string, thresholds: number[], title: (n: number) => string, description: (n: number) => string, prefix: string = group): AchievementDef[] =>
  thresholds.map(threshold => ({ id: `${prefix}-${threshold}`, group, icon, threshold, title: title(threshold), description: description(threshold) }));

export function catalog(mode: StreakMode): AchievementDef[] {
  return [
    ...tiers("concepts", "🧠", [10, 25, 50, 100, 250], n => `${n} concepts`, n => `Your knowledge graph holds ${n} concepts.`),
    ...(mode === "daily"
      ? tiers("streak", "🔥", [3, 7, 14, 30, 60, 100], n => `${n}-day streak`, n => `Study ${n} days in a row.`, "streak-days")
      : tiers("streak", "🔥", [2, 4, 8, 12, 26, 52], n => `${n}-week streak`, n => `Meet your weekly goal ${n} weeks in a row.`, "streak-weeks")),
    ...tiers("stars", "⭐", [5, 10, 25, 50], n => `${n} gold stars`, n => `Collect ${n} gold stars.`),
    ...tiers("questions", "❓", [10, 50, 100, 500], n => `${n} questions`, n => `Answer ${n} questions.`),
    ...tiers("practice", "🛠️", [1, 10, 50], n => n === 1 ? "First problem" : `${n} problems`, n => n === 1 ? "Finish your first practice problem." : `Finish ${n} practice problems.`),
    ...tiers("sessions", "📚", [1, 10, 50], n => n === 1 ? "First session" : `${n} sessions`, n => n === 1 ? "Complete your first learning session." : `Learn in ${n} different sessions.`),
    { id: "fun-perfect-run", group: "fun", icon: "🎯", threshold: 1, title: "Perfect run", description: "Answer 5 questions in a row correctly in one session." },
    { id: "fun-early-bird", group: "fun", icon: "🌅", threshold: 1, title: "Early bird", description: "Study before 7 am." },
    { id: "fun-night-owl", group: "fun", icon: "🦉", threshold: 1, title: "Night owl", description: "Study after 11 pm." },
  ];
}

export type Totals = { stars: number; questions: number; correct: number; problems: number; sessions: number; concepts: number; activeDays: number };

export type Derived = {
  totals: Totals;
  streak: Streak;
  achievements: Achievement[];
  starsByDate: Record<string, number>;
  activeDates: string[];
};

/** Combine per-session facts and concept creation dates into totals, streak and achievements. */
export function derive(sessions: Record<string, SessionFacts>, conceptDates: string[], mode: StreakMode, weeklyGoal: number, today: string): Derived {
  const facts = Object.values(sessions);
  const active = new Set(facts.flatMap(fact => fact.activeDates));
  const sortedDates = (values: string[]) => values.filter(Boolean).sort();
  const stars: StarEvent[] = facts.flatMap(fact => fact.stars).filter(star => star.source === "teacher");
  const starDates = sortedDates(stars.map(star => star.date));
  const questionDates = sortedDates(facts.flatMap(fact => fact.questionDates));
  const problemDates = sortedDates(facts.flatMap(fact => fact.problemDates));
  const sessionDates = sortedDates(facts.map(fact => fact.activeDates[0] ?? ""));
  const concepts = sortedDates(conceptDates);
  const streak = computeStreak(active, mode, weeklyGoal, today);
  const earliest = (values: (string | null)[]) => values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const fun: Record<string, string | null> = {
    "fun-perfect-run": earliest(facts.map(fact => fact.perfectRunDate)),
    "fun-early-bird": earliest(facts.map(fact => fact.earlyBirdDate)),
    "fun-night-owl": earliest(facts.map(fact => fact.nightOwlDate)),
  };
  const series: Record<Exclude<Group, "streak" | "fun">, string[]> = { concepts, stars: starDates, questions: questionDates, practice: problemDates, sessions: sessionDates };
  const achievements = catalog(mode).map((def): Achievement => {
    if (def.group === "fun") return { ...def, progress: fun[def.id] ? 1 : 0, unlockedAt: fun[def.id] ?? null };
    if (def.group === "streak") return { ...def, progress: Math.min(def.threshold, Math.max(streak.current, streak.longest)), unlockedAt: streak.reached[def.threshold] ?? null };
    const dates = series[def.group];
    return { ...def, progress: Math.min(def.threshold, dates.length), unlockedAt: dates[def.threshold - 1] ?? null };
  });
  const starsByDate: Record<string, number> = {};
  for (const date of starDates) starsByDate[date] = (starsByDate[date] ?? 0) + 1;
  return {
    totals: {
      stars: stars.length, questions: questionDates.length, correct: facts.reduce((sum, fact) => sum + fact.correctAnswers, 0),
      problems: problemDates.length, sessions: sessionDates.length, concepts: concepts.length, activeDays: active.size,
    },
    streak,
    achievements,
    starsByDate,
    activeDates: [...active].sort(),
  };
}

/** The next locked achievements closest to completion. */
export function nextMilestones(achievements: Achievement[], count = 3): Achievement[] {
  return achievements
    .filter(achievement => !achievement.unlockedAt && achievement.group !== "fun")
    .sort((a, b) => (b.progress / b.threshold) - (a.progress / a.threshold) || a.threshold - b.threshold)
    .filter((achievement, index, list) => list.findIndex(other => other.group === achievement.group) === index)
    .slice(0, count);
}
