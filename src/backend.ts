import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { localDate, localStamp } from "./dates.ts";
import { derive, nextMilestones, type Derived } from "./rewards.ts";
import { recordedTeacherStars, scanSession, STAR_TOOL_NAME, type SessionFacts } from "./scan.ts";
import { emptyState, parseState, readSettings, type RewardsState } from "./state.ts";

function record(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid operation input.");
  return input as Record<string, unknown>;
}

export type BackendOptions = { now?: () => Date; debounceMs?: number };

export function buildInstructions(derived: Derived, starCap: number): string {
  const { streak, totals } = derived;
  const unit = streak.mode === "daily" ? "day" : "week";
  const streakText = streak.current
    ? `${streak.current}-${unit} streak${streak.atRisk ? " (at risk: no activity yet today)" : streak.todayActive ? " (already active today)" : ""}`
    : `no active streak${streak.longest ? ` (best: ${streak.longest} ${unit}s)` : ""}`;
  const weekly = streak.mode === "weekly" ? ` This week: ${streak.week.activeDays}/${streak.week.goal} active days.` : "";
  const next = nextMilestones(derived.achievements, 2).map(item => `${item.title} (${item.progress}/${item.threshold})`).join(", ");
  const stars = starCap > 0
    ? ` You may call ${STAR_TOOL_NAME} with a short reason to give a gold star for genuinely excellent work (a sharp prediction, a clear explanation in the learner's own words, persistence through a hard problem) — at most ${starCap} per session, never for routine answers.`
    : "";
  return `Learner motivation context (Rewards): ${streakText}; ${totals.stars} gold stars so far.${weekly}${next ? ` Closest milestones: ${next}.` : ""} Mention progress briefly and warmly only when it fits naturally; never let it distract from learning.${stars}`;
}

export function activate(ctx: PluginBackendContext, options: BackendOptions = {}): () => void {
  const now = options.now ?? (() => new Date());
  const today = () => localDate(now());
  const debounceMs = options.debounceMs ?? 1500;
  const file = path.join(ctx.dataDirectory, "rewards.json");
  let state: RewardsState;
  let loadError: string | null = null;
  try {
    state = parseState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    state = emptyState();
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") loadError = `Could not read ${file}: ${(error as Error).message}`;
  }

  const cleanups: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  const alive = () => { if (disposed || ctx.signal.aborted) throw new Error("Rewards plugin is not active."); };

  function conceptDates(): string[] {
    try {
      const graph = ctx.learning.graph();
      const nodes = graph.propositions ?? graph.nodes ?? [];
      return nodes.map(node => localStamp(node.createdAt)?.date ?? "").filter(Boolean);
    } catch { return []; }
  }
  const compute = (current: RewardsState = state): Derived =>
    derive(current.sessions, conceptDates(), current.settings.streakMode, current.settings.weeklyGoal, today());

  // ---- Instructions (teacher awareness) ----
  let instructionHandles: (() => void)[] = [];
  let instructionKey = "";
  function refreshInstructions() {
    if (disposed) return;
    const text = !loadError && state.settings.teacher.enabled ? buildInstructions(compute(), state.settings.teacher.starCap) : "";
    if (text === instructionKey) return;
    for (const unregister of instructionHandles) unregister();
    instructionHandles = [];
    instructionKey = text;
    if (text) instructionHandles.push(ctx.registerInstructions({ agents: ["teacher", "practice"], text }));
  }
  const dayTimer = setInterval(refreshInstructions, 15 * 60_000);
  dayTimer.unref?.();

  // ---- Persistence + unlock evaluation ----
  let queue: Promise<unknown> = Promise.resolve();
  /** Apply a mutation, record newly reached achievements and notify the frontend. */
  function change(mutate: (current: RewardsState) => RewardsState): Promise<RewardsState> {
    const run = queue.then(async () => {
      alive();
      if (loadError) throw new Error(`${loadError} Fix or move the file, then restart LearnHarness.`);
      // Unlocks found by the first history scan (before backfill completed) are recorded quietly.
      const quiet = !state.backfilled;
      let next = mutate(state);
      const fresh: string[] = [];
      const derived = compute(next);
      // The streak went up through new activity (not a mode/goal change or the first history scan).
      const sameRules = next.settings.streakMode === state.settings.streakMode && next.settings.weeklyGoal === state.settings.weeklyGoal;
      const streakUp = !quiet && sameRules && derived.streak.current > compute(state).streak.current;
      const unlocked = { ...next.unlocked };
      let pruned = false;
      for (const achievement of derived.achievements) {
        // A recorded unlock the facts no longer support (e.g. the rules changed) is dropped,
        // so it can be earned and celebrated properly later.
        if (!achievement.unlockedAt && unlocked[achievement.id]) { delete unlocked[achievement.id]; pruned = true; }
        if (!achievement.unlockedAt || unlocked[achievement.id]) continue;
        unlocked[achievement.id] = { unlockedAt: achievement.unlockedAt, seen: quiet };
        if (!quiet) fresh.push(achievement.id);
      }
      if (fresh.length || pruned || Object.keys(unlocked).length !== Object.keys(next.unlocked).length) next = { ...next, unlocked };
      if (next === state) return state;
      await fs.promises.mkdir(ctx.dataDirectory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(temporary, JSON.stringify(next) + "\n", "utf8");
        await fs.promises.rename(temporary, file);
      } catch (error) {
        await fs.promises.rm(temporary, { force: true });
        throw error;
      }
      state = next;
      if (!disposed) {
        refreshInstructions();
        ctx.events.emit("rewards-changed");
        if (streakUp && state.settings.celebrations.enabled) ctx.events.emit("streak-up", { current: derived.streak.current, mode: derived.streak.mode });
        if (fresh.length && state.settings.celebrations.enabled) ctx.events.emit("celebrate", { ids: fresh });
      }
      return state;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  // ---- Scanning ----
  let scanning = false;
  function readFacts(chatId: string): SessionFacts | null {
    try { return scanSession(ctx.learning.getSession(chatId)); } catch { return null; }
  }
  async function scanAll(force = false) {
    if (loadError || disposed) return;
    scanning = true;
    try {
      let list: { id: string; updatedAt: string }[] = [];
      try { list = ctx.learning.listSessions(); } catch { list = []; }
      const updates: Record<string, SessionFacts> = {};
      for (const summary of list) {
        if (disposed) return;
        if (!force && state.sessions[summary.id]?.updatedAt === summary.updatedAt) continue;
        const facts = readFacts(summary.id);
        if (facts) updates[summary.id] = { ...facts, updatedAt: summary.updatedAt || facts.updatedAt };
      }
      await change(current => {
        const changed = Object.keys(updates).length > 0 || !current.backfilled;
        return changed ? { ...current, sessions: { ...current.sessions, ...updates }, backfilled: true } : current;
      });
    } finally { scanning = false; }
  }
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleSession(chatId: string) {
    clearTimeout(pending.get(chatId));
    const timer = setTimeout(() => {
      pending.delete(chatId);
      timers.delete(timer);
      if (disposed || loadError) return;
      const facts = readFacts(chatId);
      if (facts) void change(current => ({ ...current, sessions: { ...current.sessions, [chatId]: facts } })).catch(() => undefined);
    }, debounceMs);
    timers.add(timer);
    pending.set(chatId, timer);
  }
  let fullTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleAll() {
    clearTimeout(fullTimer);
    fullTimer = setTimeout(() => { void scanAll().catch(() => undefined); }, debounceMs);
    timers.add(fullTimer);
  }
  cleanups.push(ctx.events.on(event => {
    if (event.type === "record-changed" || event.type === "turn-settled") scheduleSession(event.chatId);
    else if (event.type === "chats-changed") scheduleAll();
  }));
  const startup = setTimeout(() => { void scanAll().catch(() => undefined); }, 0);
  timers.add(startup);

  // ---- award_star tool ----
  const awardedThisRun = new Map<string, Set<string>>();
  cleanups.push(ctx.registerTools({
    agents: ["teacher", "practice"],
    create: context => (loadError || !state.settings.teacher.enabled || state.settings.teacher.starCap === 0) ? [] : [{
      name: STAR_TOOL_NAME,
      label: "Gold star",
      description: "Award the learner a gold star for genuinely excellent work, with a short reason shown to them. Limited per session; never for routine answers.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string", minLength: 1, maxLength: 200, description: "What the learner did well, addressed to them, e.g. 'Spotted that the capacitor blocks DC on your own'." } },
        required: ["reason"],
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
        if (signal?.aborted || ctx.signal.aborted) throw new Error("Cancelled.");
        const reason = String((params as { reason?: unknown }).reason ?? "").trim().slice(0, 200);
        if (!reason) throw new Error("A reason is required.");
        let recorded = new Set<string>();
        try { recorded = recordedTeacherStars(ctx.learning.getSession(context.chatId)); } catch { /* New session. */ }
        const mine = awardedThisRun.get(context.chatId) ?? new Set<string>();
        const given = new Set([...recorded, ...mine]);
        const cap = state.settings.teacher.starCap;
        if (given.size >= cap) throw new Error(`The gold star limit for this session (${cap}) is reached. Praise in words instead.`);
        mine.add(toolCallId);
        awardedThisRun.set(context.chatId, mine);
        const total = compute().totals.stars + 1;
        return {
          content: [{ type: "text" as const, text: `Gold star awarded (${given.size + 1}/${cap} this session; ${total} total): ${reason}` }],
          details: { reason, total, sessionCount: given.size + 1, cap },
        };
      },
    }],
  }));

  // ---- Frontend operations ----
  function view() {
    const derived = compute();
    return {
      loadError,
      today: today(),
      scanning,
      settings: state.settings,
      totals: derived.totals,
      streak: derived.streak,
      achievements: derived.achievements.map(achievement => ({ ...achievement, seen: state.unlocked[achievement.id]?.seen ?? false })),
      nextMilestones: nextMilestones(derived.achievements),
      starsByDate: derived.starsByDate,
      activeDates: derived.activeDates,
      unseen: Object.entries(state.unlocked).filter(([, value]) => !value.seen).map(([id]) => id),
      reminderClaimed: state.reminderClaimed,
    };
  }
  function handle(name: string, handler: (input: Record<string, unknown>) => unknown) {
    cleanups.push(ctx.handle(name, input => { alive(); return handler(record(input ?? {})); }));
  }
  handle("get-state", () => view());
  handle("save-settings", async input => {
    const settings = readSettings(input.settings);
    await change(current => ({ ...current, settings }));
    return view();
  });
  handle("mark-seen", async input => {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === "string") : [];
    await change(current => {
      if (!ids.some(id => current.unlocked[id] && !current.unlocked[id]!.seen)) return current;
      const unlocked = { ...current.unlocked };
      for (const id of ids) if (unlocked[id]) unlocked[id] = { ...unlocked[id]!, seen: true };
      return { ...current, unlocked };
    });
    return view();
  });
  handle("claim-reminder", async input => {
    if (typeof input.date !== "string" || input.date !== today()) return { claimed: false };
    let claimed = false;
    await change(current => {
      if (current.reminderClaimed === input.date) return current;
      claimed = true;
      return { ...current, reminderClaimed: input.date as string };
    });
    return { claimed };
  });
  handle("rescan", async () => { await scanAll(true); return view(); });

  refreshInstructions();

  return () => {
    disposed = true;
    clearInterval(dayTimer);
    for (const timer of timers) clearTimeout(timer);
    for (const timer of pending.values()) clearTimeout(timer);
    for (const unregister of instructionHandles) unregister();
    instructionHandles = [];
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch { /* Continue releasing. */ }
    }
  };
}
