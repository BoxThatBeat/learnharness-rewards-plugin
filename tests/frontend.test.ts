/** DOM integration test: real frontend + real backend through fake hosts. Host widgets are
 * minimal stand-ins, so this checks plugin logic and wiring, not host rendering. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Window } from "happy-dom";
import type { PluginFrontendContext, PluginToolRenderer, PluginView } from "learnharness-plugin-api";
import { activate as activateBackend } from "../src/backend.ts";
import { activate as activateFrontend } from "../src/main.ts";
import { reminderDue } from "../src/reminders.ts";
import { fakeHost, type FakeSessions } from "./helpers.ts";

const window = new Window();
Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement });
const doc = window.document as unknown as Document;
const flush = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const at = (iso: string) => new Date(iso).getTime();

function frontendHost(call: (name: string, input?: unknown) => Promise<unknown>) {
  const views = new Map<string, PluginView>();
  const renderers = new Map<string, PluginToolRenderer>();
  const notifications: ((event: { topic: string; data?: unknown }) => void)[] = [];
  const surfaces: { title: string; box: HTMLElement; close: () => void }[] = [];
  let settings: ((container: HTMLElement, signal: AbortSignal) => unknown) | undefined;
  let settingsSchema: { rows: { key: string; value: unknown; onChange: (value: never) => unknown }[] } | undefined;
  const button = (container: HTMLElement, props: Record<string, unknown>) => {
    const node = doc.createElement("button");
    node.textContent = String(props.label);
    node.addEventListener("click", () => { void (props.onClick as () => unknown)(); });
    container.append(node);
    return { update() {}, dispose() { node.remove(); } };
  };
  const overlay = (props: { title: string; content: (container: HTMLElement, signal: AbortSignal) => unknown; onClose?: () => void }) => {
    const controller = new AbortController();
    const box = doc.createElement("div");
    doc.body.append(box);
    const cleanup = props.content(box, controller.signal);
    const dispose = () => { controller.abort(); if (typeof cleanup === "function") (cleanup as () => void)(); box.remove(); };
    surfaces.push({ title: props.title, box, close: () => { dispose(); props.onClose?.(); } });
    return { update() {}, dispose };
  };
  const ctx = {
    signal: new AbortController().signal,
    call,
    registerView(view: PluginView) { views.set(view.id, view); return () => {}; },
    registerAction() { return () => {}; },
    placeAction() { return () => {}; },
    registerSettings(mount: typeof settings) { settings = mount; return () => {}; },
    registerToolRenderer(renderer: PluginToolRenderer) { renderers.set(renderer.toolName, renderer); return () => {}; },
    onNotification(listener: (event: { topic: string; data?: unknown }) => void) { notifications.push(listener); return () => {}; },
    onResync() { return () => {}; },
    app: { openView() {}, openSettings() {}, openSession() {}, openHome() {}, pathname: () => "/" },
    ui: {
      mountButton: button,
      mountSettingsRows(_container: HTMLElement, schema: typeof settingsSchema) { settingsSchema = schema; return { update(next: typeof settingsSchema) { settingsSchema = next; }, dispose() {} }; },
      openSurface: overlay,
      openDialog: overlay,
    },
  };
  const dispose = activateFrontend(ctx as unknown as PluginFrontendContext);
  return { dispose, views, renderers, surfaces, notify: (topic: string, data?: unknown) => { for (const listener of notifications) listener({ topic, data }); }, settings: () => settings!, schema: () => settingsSchema! };
}

test("Rewards page draws the streak line, celebrates unlocks, renders star cards and saves settings", async () => {
  const sessions: FakeSessions = new Map([["chat-1", { updatedAt: "u1", messages: ["2026-11-02", "2026-11-03", "2026-11-04"].map(date => ({ role: "user", content: "x", timestamp: at(`${date}T10:00:00`) })) }]]);
  const backend = fakeHost(fs.mkdtempSync(path.join(os.tmpdir(), "rewards-ui-")), sessions);
  const disposeBackend = activateBackend(backend.ctx, { now: () => new Date("2026-11-05T20:00:00"), debounceMs: 5 });
  await flush();
  const host = frontendHost(backend.call);
  try {

  // Calendar: Nov 2–4 joined by one line; today (Nov 5) pending.
  const root = doc.createElement("div");
  doc.body.append(root);
  host.views.get("rewards")!.mount(root, new AbortController().signal);
  await flush();
  assert.match(root.querySelector(".rw-hero__title")!.textContent!, /^3 days streak/);
  assert.equal(root.querySelector(".rw-hero__status")!.textContent, "Study today to keep your streak");
  const lineFor = (date: string) => root.querySelector(`.rw-day[data-date="${date}"] .rw-line`)!.className;
  assert.equal(lineFor("2026-11-02"), "rw-line is-on is-start");
  assert.equal(lineFor("2026-11-03"), "rw-line is-on");
  assert.equal(lineFor("2026-11-04"), "rw-line is-on is-end");
  assert.equal(lineFor("2026-11-05"), "rw-line is-pending");
  assert.equal(lineFor("2026-11-06"), "rw-line");
  assert.match(root.querySelector('.rw-day[data-date="2026-11-03"]')!.getAttribute("aria-label")!, /in a streak, active$/);

  // A new unlock is pushed by the backend → celebration overlay → closing marks it seen.
  sessions.set("chat-2", { updatedAt: "u2", messages: Array.from({ length: 10 }, (_, index) => ({ role: "toolResult", toolCallId: `q${index}`, toolName: "quiz", content: [], isError: false, timestamp: at("2026-11-05T20:30:00"), details: { correct: true, answeredAt: "2026-11-05T20:30:00" } })) });
  backend.fire({ type: "record-changed", chatId: "chat-2" });
  await flush();
  const celebrateEvent = backend.emitted.find(event => event.topic === "celebrate")!;
  host.notify("rewards-changed");
  host.notify("celebrate", celebrateEvent.data);
  await flush();
  const overlay = host.surfaces.at(-1)!;
  assert.equal(overlay.title, "Achievements unlocked");
  assert.match(overlay.box.textContent!, /Achievements unlocked![\s\S]*10 gold stars/);
  (overlay.box.querySelector(".rw-celebrate") as HTMLElement).click();
  await flush();
  assert.deepEqual(((await backend.call("get-state")) as { unseen: string[] }).unseen, []);

  // Achievements tab.
  [...root.querySelectorAll("button")].find(node => node.textContent === "Achievements")!.dispatchEvent(new window.Event("click") as unknown as Event);
  await flush();
  const unlockedBadges = [...root.querySelectorAll(".rw-badge.is-unlocked .rw-badge__title")].map(node => node.textContent);
  assert.ok(unlockedBadges.includes("10 gold stars") && unlockedBadges.includes("3-day streak"));

  // Gold star card.
  const card = doc.createElement("div");
  host.renderers.get("award_star")!.mount(card, { toolName: "award_star", toolCallId: "s", input: { reason: "x" }, state: "output-available", result: { content: [], isError: false, details: { reason: "Nice derivation", total: 11 } }, signal: new AbortController().signal } as never);
  assert.match(card.textContent!, /Gold star!Nice derivation11 gold stars total/);

  // Settings rows save through the backend.
  const settingsRoot = doc.createElement("div");
  host.settings()(settingsRoot, new AbortController().signal);
  await flush();
  const mode = host.schema().rows.find(row => row.key === "streak-mode")!;
  await mode.onChange("weekly" as never);
  assert.equal(host.schema().rows.find(row => row.key === "streak-mode")!.value, "weekly");
  assert.equal(((await backend.call("get-state")) as { settings: { streakMode: string } }).settings.streakMode, "weekly");
  } finally {
    host.dispose();
    disposeBackend();
  }
});

test("reminder timing logic", () => {
  const view = (overrides: Record<string, unknown> = {}) => ({
    settings: { streakMode: "daily", weeklyGoal: 3, reminder: { enabled: true, time: "19:00", os: true }, celebrations: { enabled: true, sound: false }, teacher: { enabled: true, starCap: 3 } },
    streak: { mode: "daily", todayActive: false, week: { met: false } },
    reminderClaimed: null,
    ...overrides,
  }) as never;
  assert.equal(reminderDue(view(), new Date("2026-11-05T18:59:00")), false);
  assert.equal(reminderDue(view(), new Date("2026-11-05T19:00:00")), true);
  assert.equal(reminderDue(view({ reminderClaimed: "2026-11-05" }), new Date("2026-11-05T20:00:00")), false);
  assert.equal(reminderDue(view({ streak: { mode: "daily", todayActive: true, week: { met: false } } }), new Date("2026-11-05T20:00:00")), false);
  assert.equal(reminderDue(view({ streak: { mode: "weekly", todayActive: false, week: { met: true } } }), new Date("2026-11-05T20:00:00")), false);
});
