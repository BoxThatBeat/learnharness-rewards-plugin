/** Defensive, read-only extraction of learning activity from a native session record.
 * Unknown or malformed shapes are skipped, never thrown: the host's record format is
 * owned by the app, and this plugin must keep working when it evolves. */
import { localStamp } from "./dates.ts";

export const STAR_TOOL_NAME = "award_star";
const QUIZ_TOOLS = new Set(["quiz", "explain"]);
const CONCLUDE_TOOL = "conclude";
const PRACTICE_MARKERS = new Set(["practice-thinking", "plugin-problem-submission"]);

/** Gold stars come only from the teacher. Records saved by 0.1.0 may still hold automatic
 * "quiz"/"practice" stars; those are ignored when counting. */
export type StarEvent = { date: string; source: "quiz" | "practice" | "teacher"; reason?: string; id: string };

export type SessionFacts = {
  updatedAt: string;
  /** Unique local dates with learner activity, ascending. */
  activeDates: string[];
  /** One date per answered question (native or plugin), in record order. */
  questionDates: string[];
  correctAnswers: number;
  /** Date the session first reached 5 correct answers in a row, if ever. */
  perfectRunDate: string | null;
  /** One date per practice problem concluded (not dismissed). */
  problemDates: string[];
  stars: StarEvent[];
  earlyBirdDate: string | null;
  nightOwlDate: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const PERFECT_RUN = 5;

export function scanSession(record: unknown): SessionFacts | null {
  if (!isRecord(record) || !Array.isArray(record.messages)) return null;
  const active = new Set<string>();
  const facts: SessionFacts = {
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    activeDates: [], questionDates: [], correctAnswers: 0, perfectRunDate: null,
    problemDates: [], stars: [], earlyBirdDate: null, nightOwlDate: null,
  };
  let run = 0;
  const activity = (value: unknown, fallback?: unknown) => {
    const stamp = localStamp(value) ?? localStamp(fallback);
    if (!stamp) return null;
    active.add(stamp.date);
    if (stamp.hour < 7 && (!facts.earlyBirdDate || stamp.date < facts.earlyBirdDate)) facts.earlyBirdDate = stamp.date;
    if (stamp.hour >= 23 && (!facts.nightOwlDate || stamp.date < facts.nightOwlDate)) facts.nightOwlDate = stamp.date;
    return stamp.date;
  };

  for (const message of record.messages) {
    if (!isRecord(message)) continue;
    if (message.role === "user") {
      activity(message.timestamp);
      continue;
    }
    if (message.role === "custom") {
      if (typeof message.customType === "string" && PRACTICE_MARKERS.has(message.customType)) {
        const details = isRecord(message.details) ? message.details : {};
        activity(details.submittedAt, message.timestamp);
      }
      continue;
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!isRecord(part) || part.type !== "toolCall" || part.name !== CONCLUDE_TOOL) continue;
        const args = isRecord(part.arguments) ? part.arguments : {};
        if (args.outcome === "dismissed") continue;
        const stamp = localStamp(message.timestamp);
        if (!stamp) continue;
        facts.problemDates.push(stamp.date);
      }
      continue;
    }
    if (message.role !== "toolResult" || message.isError === true) continue;
    const details = isRecord(message.details) ? message.details : null;
    if (typeof message.toolName === "string" && QUIZ_TOOLS.has(message.toolName) && details) {
      if (details.dismissed === true) continue;
      const date = activity(details.answeredAt, message.timestamp);
      if (!date) continue;
      facts.questionDates.push(date);
      if (details.correct === true) {
        facts.correctAnswers++;
        run++;
        if (run >= PERFECT_RUN && !facts.perfectRunDate) facts.perfectRunDate = date;
      } else if (details.correct === false) run = 0;
      continue;
    }
    if (details?.kind === "plugin-question") {
      const date = activity(details.answeredAt, message.timestamp);
      if (date) facts.questionDates.push(date);
      continue;
    }
    if (message.toolName === STAR_TOOL_NAME && details) {
      const stamp = localStamp(message.timestamp);
      if (!stamp) continue;
      facts.stars.push({
        date: stamp.date, source: "teacher", id: `teacher:${String(message.toolCallId ?? facts.stars.length)}`,
        ...(typeof details.reason === "string" ? { reason: details.reason.slice(0, 300) } : {}),
      });
    }
  }
  facts.activeDates = [...active].sort();
  return facts;
}

/** Teacher stars already recorded in a session (for the per-session cap). */
export function recordedTeacherStars(record: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(record) || !Array.isArray(record.messages)) return ids;
  for (const message of record.messages) {
    if (isRecord(message) && message.role === "toolResult" && message.toolName === STAR_TOOL_NAME && message.isError !== true && typeof message.toolCallId === "string") {
      ids.add(message.toolCallId);
    }
  }
  return ids;
}
