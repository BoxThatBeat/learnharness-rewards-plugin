import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { activate } from "../src/backend.ts";
import { fakeHost, type FakeSessions } from "./helpers.ts";

const at = (iso: string) => new Date(iso).getTime();
const userMessage = (iso: string) => ({ role: "user", content: "hi", timestamp: at(iso) });
const correctQuiz = (id: string, iso: string) => ({ role: "toolResult", toolCallId: id, toolName: "quiz", content: [], isError: false, timestamp: at(iso), details: { correct: true, answeredAt: iso } });

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rewards-"));
const flush = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const clock = (iso: string) => () => new Date(iso);

test("first scan backfills history quietly, later activity unlocks and celebrates", async () => {
  const dir = temp();
  const sessions: FakeSessions = new Map([["chat-1", { updatedAt: "u1", messages: [userMessage("2026-11-01T10:00:00"), userMessage("2026-11-02T10:00:00"), userMessage("2026-11-03T10:00:00")] }]]);
  const host = fakeHost(dir, sessions);
  activate(host.ctx, { now: clock("2026-11-03T20:00:00"), debounceMs: 5 });
  await flush();
  const first = await host.call("get-state");
  assert.equal(first.streak.current, 3);
  assert.equal(first.totals.concepts, 10);
  const unlockedFromHistory = first.achievements.filter((item: { unlockedAt: string | null }) => item.unlockedAt).map((item: { id: string }) => item.id).sort();
  assert.deepEqual(unlockedFromHistory, ["concepts-10", "sessions-1", "streak-days-3"]);
  assert.deepEqual(first.unseen, [], "history unlocks are not celebrated");
  assert.equal(host.emitted.some(event => event.topic === "celebrate"), false);
  assert.match(host.instructions()[0]!.text, /3-day streak \(already active today\)/);

  // New activity in another session: correct answers earn no stars; scanning is event-driven.
  sessions.set("chat-2", { updatedAt: "u2", messages: Array.from({ length: 10 }, (_, index) => correctQuiz(`q${index}`, "2026-11-03T21:00:00")) });
  host.fire({ type: "record-changed", chatId: "chat-2" });
  await flush();
  const next = await host.call("get-state");
  assert.equal(next.totals.stars, 0, "only the teacher awards stars");
  assert.equal(next.totals.correct, 10);
  assert.deepEqual(next.unseen.sort(), ["fun-perfect-run", "questions-10"]);
  const celebrate = host.emitted.find(event => event.topic === "celebrate")!;
  assert.deepEqual((celebrate.data as { ids: string[] }).ids.sort(), next.unseen.sort());
  await host.call("mark-seen", { ids: next.unseen });
  assert.deepEqual((await host.call("get-state")).unseen, []);
});

test("award_star respects the per-session cap across the record and the current turn", async () => {
  const sessions: FakeSessions = new Map([["chat-1", { updatedAt: "u1", messages: [
    { role: "toolResult", toolCallId: "old", toolName: "award_star", content: [], isError: false, timestamp: at("2026-11-03T10:00:00"), details: { reason: "earlier" } },
  ] }]]);
  const host = fakeHost(temp(), sessions);
  activate(host.ctx, { now: clock("2026-11-03T20:00:00"), debounceMs: 5 });
  await flush();
  await host.call("save-settings", { settings: { streakMode: "daily", weeklyGoal: 3, reminder: { enabled: false, time: "19:00" }, celebrations: { enabled: true, sound: false }, teacher: { enabled: true, starCap: 2 } } });
  const [star] = host.tools();
  const result = await star!.execute("new-1", { reason: "Derived the time constant yourself" });
  assert.match((result.content[0] as { text: string }).text, /Gold star awarded \(2\/2 this session/);
  await assert.rejects(star!.execute("new-2", { reason: "again" }), /limit for this session \(2\) is reached/);
  assert.equal(host.tools("chat-other").length, 1);
  assert.match(host.instructions()[0]!.text, /at most 2 per session/);

  await host.call("save-settings", { settings: { streakMode: "daily", weeklyGoal: 3, reminder: { enabled: false, time: "19:00" }, celebrations: { enabled: true, sound: false }, teacher: { enabled: false, starCap: 2 } } });
  assert.equal(host.tools().length, 0);
  assert.equal(host.instructions().length, 0);
});

test("weekly mode, reminder claims, persistence, and refusal of newer data", async () => {
  const dir = temp();
  const sessions: FakeSessions = new Map([["chat-1", { updatedAt: "u1", messages: ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-10"].map(date => userMessage(`${date}T10:00:00`)) }]]);
  const host = fakeHost(dir, sessions);
  const dispose = activate(host.ctx, { now: clock("2026-11-11T20:00:00"), debounceMs: 5 });
  await flush();
  const weekly = await host.call("save-settings", { settings: { streakMode: "weekly", weeklyGoal: 3, reminder: { enabled: true, time: "19:00" }, celebrations: { enabled: true, sound: false }, teacher: { enabled: true, starCap: 3 } } });
  assert.equal(weekly.streak.mode, "weekly");
  assert.equal(weekly.streak.current, 1);
  assert.deepEqual(weekly.streak.week, { start: "2026-11-09", activeDays: 1, goal: 3, met: false, daysLeft: 5 });
  assert.deepEqual(await host.call("claim-reminder", { date: "2026-11-11" }), { claimed: true });
  assert.deepEqual(await host.call("claim-reminder", { date: "2026-11-11" }), { claimed: false }, "only one window reminds per day");
  assert.deepEqual(await host.call("claim-reminder", { date: "2026-11-10" }), { claimed: false }, "stale dates are refused");
  dispose();

  const again = fakeHost(dir, new Map());
  activate(again.ctx, { now: clock("2026-11-11T20:00:00"), debounceMs: 5 });
  await flush();
  const restored = await again.call("get-state");
  assert.equal(restored.settings.streakMode, "weekly");
  assert.equal(restored.totals.activeDays, 4, "facts from a deleted session are kept");

  const file = path.join(dir, "rewards.json");
  fs.writeFileSync(file, JSON.stringify({ version: 3 }));
  const newer = fakeHost(dir, new Map());
  activate(newer.ctx, { debounceMs: 5 });
  await flush();
  assert.match((await newer.call("get-state")).loadError, /newer than this plugin understands/);
  await assert.rejects(newer.call("mark-seen", { ids: [] }), /Fix or move the file/);
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify({ version: 3 }));
});
