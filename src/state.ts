import type { SessionFacts } from "./scan.ts";
import type { StreakMode } from "./rewards.ts";

export const STATE_VERSION = 1;

export type Settings = {
  streakMode: StreakMode;
  weeklyGoal: number;
  reminder: { enabled: boolean; time: string; os: boolean };
  celebrations: { enabled: boolean; sound: boolean };
  teacher: { enabled: boolean; starCap: number };
};

export type RewardsState = {
  version: typeof STATE_VERSION;
  settings: Settings;
  /** Per-session facts; kept after a session is deleted so earned rewards stay earned. */
  sessions: Record<string, SessionFacts>;
  unlocked: Record<string, { unlockedAt: string; seen: boolean }>;
  /** Local date of the last reminder any window showed. */
  reminderClaimed: string | null;
  /** Set once the first full history scan has run (its unlocks are not celebrated). */
  backfilled: boolean;
};

export function defaultSettings(): Settings {
  return {
    streakMode: "daily",
    weeklyGoal: 3,
    reminder: { enabled: false, time: "19:00", os: true },
    celebrations: { enabled: true, sound: false },
    teacher: { enabled: true, starCap: 3 },
  };
}

export function emptyState(): RewardsState {
  return { version: STATE_VERSION, settings: defaultSettings(), sessions: {}, unlocked: {}, reminderClaimed: null, backfilled: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function int(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be on or off.`);
  return value;
}

/** Validate a complete settings object (from the UI or disk). */
export function readSettings(value: unknown): Settings {
  if (!isRecord(value) || !isRecord(value.reminder) || !isRecord(value.celebrations) || !isRecord(value.teacher)) throw new Error("Settings are malformed.");
  if (value.streakMode !== "daily" && value.streakMode !== "weekly") throw new Error("Streak mode must be daily or weekly.");
  if (typeof value.reminder.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.reminder.time)) throw new Error("Reminder time must be HH:MM (24-hour).");
  return {
    streakMode: value.streakMode,
    weeklyGoal: int(value.weeklyGoal, "Weekly goal", 1, 7),
    reminder: { enabled: bool(value.reminder.enabled, "Reminders"), time: value.reminder.time, os: bool(value.reminder.os, "Desktop notifications") },
    celebrations: { enabled: bool(value.celebrations.enabled, "Celebrations"), sound: bool(value.celebrations.sound, "Sound") },
    teacher: { enabled: bool(value.teacher.enabled, "Teacher awareness"), starCap: int(value.teacher.starCap, "Stars per session", 0, 20) },
  };
}

function readFacts(value: unknown): SessionFacts | null {
  if (!isRecord(value) || !Array.isArray(value.activeDates) || !Array.isArray(value.stars)) return null;
  const strings = (input: unknown) => Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : [];
  const nullable = (input: unknown) => typeof input === "string" ? input : null;
  return {
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    activeDates: strings(value.activeDates),
    questionDates: strings(value.questionDates),
    correctAnswers: typeof value.correctAnswers === "number" ? value.correctAnswers : 0,
    perfectRunDate: nullable(value.perfectRunDate),
    problemDates: strings(value.problemDates),
    stars: value.stars.filter((star): star is SessionFacts["stars"][number] =>
      isRecord(star) && typeof star.date === "string" && typeof star.id === "string" && (star.source === "quiz" || star.source === "practice" || star.source === "teacher")),
    earlyBirdDate: nullable(value.earlyBirdDate),
    nightOwlDate: nullable(value.nightOwlDate),
  };
}

/** Parse saved state; refuses newer formats rather than rewriting them. */
export function parseState(raw: unknown): RewardsState {
  if (!isRecord(raw) || typeof raw.version !== "number") throw new Error("Saved rewards data has no version.");
  if (raw.version > STATE_VERSION) throw new Error(`Saved rewards data uses format ${raw.version}, newer than this plugin understands (${STATE_VERSION}). Update the plugin; the file was not changed.`);
  if (raw.version !== STATE_VERSION) throw new Error(`Unsupported rewards data format ${raw.version}.`);
  const sessions: Record<string, SessionFacts> = {};
  if (isRecord(raw.sessions)) for (const [id, value] of Object.entries(raw.sessions)) { const facts = readFacts(value); if (facts) sessions[id] = facts; }
  const unlocked: RewardsState["unlocked"] = {};
  if (isRecord(raw.unlocked)) for (const [id, value] of Object.entries(raw.unlocked)) {
    if (isRecord(value) && typeof value.unlockedAt === "string") unlocked[id] = { unlockedAt: value.unlockedAt, seen: value.seen === true };
  }
  return {
    version: STATE_VERSION,
    settings: (() => { try { return readSettings(raw.settings); } catch { return defaultSettings(); } })(),
    sessions,
    unlocked,
    reminderClaimed: typeof raw.reminderClaimed === "string" ? raw.reminderClaimed : null,
    backfilled: raw.backfilled === true,
  };
}
