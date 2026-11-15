import type { PluginFrontendContext } from "learnharness-plugin-api";
import { celebrate, streakUp } from "./celebrate.ts";
import { setupReminders } from "./reminders.ts";
import { STAR_TOOL_NAME } from "./scan.ts";
import { mountSettings } from "./settings.ts";
import { mountStarCard } from "./star-card.ts";
import { subscribeState, type StateView } from "./ui-common.ts";
import { mountRewardsView } from "./view.ts";

const TROPHY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
const FLAME_PATH = "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z";
/** Orange and filled once this period counts toward the streak; an outline until then. */
const flameIcon = (lit: boolean) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="${lit ? "#f97316" : "none"}" stroke="${lit ? "#f97316" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${FLAME_PATH}"/></svg>`;

export function activate(ctx: PluginFrontendContext): () => void {
  const registrations: (() => void)[] = [];
  const openRewards = () => ctx.app.openView("rewards");
  registrations.push(ctx.registerView({ id: "rewards", name: "Rewards", mount: (container, signal) => mountRewardsView(ctx, container, signal) }));
  registrations.push(ctx.registerAction({ id: "open", name: "Rewards", icon: TROPHY_ICON, run: openRewards }));
  registrations.push(ctx.placeAction({ id: "open-sidebar", actionId: "open", location: "sidebar" }));
  registrations.push(ctx.registerSettings((container: HTMLElement, signal: AbortSignal) => mountSettings(ctx, container, signal)));
  registrations.push(ctx.registerToolRenderer({ toolName: STAR_TOOL_NAME, mount: mountStarCard }));
  registrations.push(setupReminders(ctx, openRewards));

  // Streak flame + count in the top bar of sessions and the Rewards page. The host draws an
  // action as icon + name and captures both at registration, so re-register when they change.
  let streakAction: (() => void)[] = [];
  let streakKey = "";
  const removeStreakAction = () => { for (const unregister of streakAction.splice(0).reverse()) unregister(); };
  subscribeState(ctx, ctx.signal, view => {
    const { streak } = view;
    const lit = streak.current > 0 && (streak.mode === "daily" ? streak.todayActive : streak.week.met);
    const key = `${streak.current}:${lit}`;
    if (key === streakKey) return;
    streakKey = key;
    removeStreakAction();
    streakAction.push(ctx.registerAction({ id: "streak", name: String(streak.current), icon: flameIcon(lit), run: openRewards }));
    streakAction.push(ctx.placeAction({ id: "streak-top-bar", actionId: "streak", location: "top-bar", sessions: ["teaching", "practice"], views: ["rewards"] }));
  }, () => undefined);
  registrations.push(removeStreakAction);

  // Overlays play one at a time: a streak tick first, then any unlocks it caused.
  let overlays: Promise<void> = Promise.resolve();
  const enqueue = (show: (done: () => void) => void) => {
    overlays = overlays.then(() => new Promise<void>(resolve => {
      if (ctx.signal.aborted) { resolve(); return; }
      try { show(resolve); } catch { resolve(); }
    }));
  };

  // Celebrate unseen unlocks: pushed by the backend, and any left over from while no window was open.
  const shown = new Set<string>();
  let busy = false;
  async function celebrateUnseen(ids?: string[]) {
    if (busy || ctx.signal.aborted) return;
    busy = true;
    try {
      const view = await ctx.call<StateView>("get-state");
      const wanted = new Set(ids ?? view.unseen);
      const fresh = view.achievements.filter(item => wanted.has(item.id) && item.unlockedAt && !item.seen && !shown.has(item.id));
      if (!fresh.length) return;
      for (const item of fresh) shown.add(item.id);
      const markSeen = () => { void ctx.call("mark-seen", { ids: fresh.map(item => item.id) }).catch(() => undefined); };
      if (!view.settings.celebrations.enabled) { markSeen(); return; }
      enqueue(done => celebrate(ctx, fresh, { sound: view.settings.celebrations.sound, onDone: () => { markSeen(); done(); } }));
    } catch { /* Celebrations are best-effort. */ }
    finally { busy = false; }
  }
  let sound = false;
  subscribeState(ctx, ctx.signal, view => { sound = view.settings.celebrations.sound; }, () => undefined);
  registrations.push(ctx.onNotification(event => {
    if (event.topic !== "streak-up") return;
    const { current, mode } = (event.data ?? {}) as { current?: unknown; mode?: unknown };
    if (typeof current !== "number" || current < 1 || (mode !== "daily" && mode !== "weekly")) return;
    enqueue(done => streakUp(ctx, { current, mode }, { sound, onDone: done }));
  }));
  registrations.push(ctx.onNotification(event => {
    if (event.topic !== "celebrate") return;
    const ids = (event.data as { ids?: unknown } | undefined)?.ids;
    void celebrateUnseen(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : undefined);
  }));
  const startup = setTimeout(() => { void celebrateUnseen(); }, 3_000);
  registrations.push(() => clearTimeout(startup));

  return () => {
    for (const unregister of registrations.reverse()) {
      try { unregister(); } catch { /* Continue releasing. */ }
    }
  };
}
