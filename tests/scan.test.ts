import assert from "node:assert/strict";
import { test } from "node:test";
import { recordedTeacherStars, scanSession } from "../src/scan.ts";

const at = (iso: string) => new Date(iso).getTime();

/** Fixture built from the SDK's native message shapes (pi-ai + LhMarkerMessage). */
const record = {
  id: "chat-1",
  updatedAt: "2026-11-03T20:00:00Z",
  messages: [
    { id: "1", role: "user", content: "Teach me Ohm's law", timestamp: at("2026-11-02T06:30:00") },
    { id: "2", role: "assistant", content: [{ type: "toolCall", id: "q1", name: "quiz", arguments: {} }], timestamp: at("2026-11-02T06:31:00") },
    { id: "3", role: "toolResult", toolCallId: "q1", toolName: "quiz", content: [], isError: false, timestamp: at("2026-11-02T06:32:00"), details: { correct: true, answeredAt: "2026-11-02T06:32:00" } },
    { id: "4", role: "toolResult", toolCallId: "q2", toolName: "quiz", content: [], isError: false, timestamp: at("2026-11-02T06:33:00"), details: { correct: false, answeredAt: "2026-11-02T06:33:00" } },
    ...Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, role: "toolResult", toolCallId: `c${index}`, toolName: "explain", content: [], isError: false, timestamp: at("2026-11-03T10:00:00"), details: { correct: true, answeredAt: "2026-11-03T10:00:00" } })),
    { id: "5", role: "toolResult", toolCallId: "q3", toolName: "quiz", content: [], isError: false, timestamp: at("2026-11-03T10:05:00"), details: { dismissed: true, answeredAt: "2026-11-03T10:05:00" } },
    { id: "6", role: "toolResult", toolCallId: "pq", toolName: "lab_question", content: [], isError: false, timestamp: at("2026-11-03T23:30:00"), details: { kind: "plugin-question", answeredAt: "2026-11-03T23:30:00" } },
    { id: "7", role: "custom", customType: "practice-thinking", content: "", display: true, details: {}, timestamp: at("2026-11-04T12:00:00") },
    { id: "8", role: "assistant", content: [{ type: "toolCall", id: "k1", name: "conclude", arguments: { outcome: "solved" } }], timestamp: at("2026-11-04T12:10:00") },
    { id: "9", role: "assistant", content: [{ type: "toolCall", id: "k2", name: "conclude", arguments: { outcome: "dismissed" } }], timestamp: at("2026-11-04T12:20:00") },
    { id: "10", role: "toolResult", toolCallId: "s1", toolName: "award_star", content: [], isError: false, timestamp: at("2026-11-04T12:30:00"), details: { reason: "Great derivation" } },
    { id: "11", role: "toolResult", toolCallId: "s2", toolName: "award_star", content: [], isError: true, timestamp: at("2026-11-04T12:31:00"), details: { reason: "cap" } },
    { id: "12", role: "custom", customType: "compaction", content: "", display: false, details: {}, timestamp: at("2026-11-09T12:00:00") },
    "garbage",
    { role: "toolResult", toolName: "quiz", details: { correct: true } },
  ],
};

test("scanner extracts activity, answers, stars, conclusions and fun flags", () => {
  const facts = scanSession(record)!;
  assert.deepEqual(facts.activeDates, ["2026-11-02", "2026-11-03", "2026-11-04"], "compaction marker is not learner activity");
  assert.equal(facts.questionDates.length, 2 + 5 + 1);
  assert.equal(facts.correctAnswers, 6);
  assert.equal(facts.perfectRunDate, "2026-11-03");
  assert.deepEqual(facts.problemDates, ["2026-11-04"]);
  assert.deepEqual(facts.stars.map(star => `${star.source}:${star.date}`), [
    "quiz:2026-11-02", ...Array(5).fill("quiz:2026-11-03"), "practice:2026-11-04", "teacher:2026-11-04",
  ]);
  assert.equal(facts.stars.at(-1)!.reason, "Great derivation");
  assert.equal(facts.earlyBirdDate, "2026-11-02");
  assert.equal(facts.nightOwlDate, "2026-11-03");
  assert.deepEqual([...recordedTeacherStars(record)], ["s1"]);
});

test("scanner tolerates missing or malformed records", () => {
  assert.equal(scanSession(null), null);
  assert.equal(scanSession({ messages: "nope" }), null);
  assert.deepEqual(scanSession({ messages: [] })!.activeDates, []);
});
