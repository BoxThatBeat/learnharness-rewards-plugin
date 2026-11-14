import type { PluginFrontendContext } from "learnharness-plugin-api";
import type { Achievement, Streak, Totals } from "./rewards.ts";
import type { Settings } from "./state.ts";

export type AchievementView = Achievement & { seen: boolean };
export type StateView = {
  loadError: string | null;
  today: string;
  scanning: boolean;
  settings: Settings;
  totals: Totals;
  streak: Streak;
  achievements: AchievementView[];
  nextMilestones: Achievement[];
  starsByDate: Record<string, number>;
  activeDates: string[];
  unseen: string[];
  reminderClaimed: string | null;
};

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function iconButton(doc: Document, label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const button = el(doc, "button", "rw-icon-button", glyph);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

export function progressBar(doc: Document, value: number, max: number, label: string): HTMLElement {
  const bar = el(doc, "div", "rw-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuenow", String(value));
  bar.setAttribute("aria-valuemax", String(max));
  const fill = el(doc, "div", "rw-bar__fill");
  fill.style.width = `${max ? Math.min(100, Math.round((value / max) * 100)) : 0}%`;
  bar.append(fill);
  return bar;
}

/** Re-fetch state on this plugin's notifications/resync; latest request wins. */
export function subscribeState(ctx: PluginFrontendContext, signal: AbortSignal, apply: (view: StateView) => void, onError: (error: unknown) => void): () => Promise<void> {
  let generation = 0;
  const refresh = async () => {
    const mine = ++generation;
    try {
      const view = await ctx.call<StateView>("get-state");
      if (mine === generation && !signal.aborted) apply(view);
    } catch (error) { if (!signal.aborted) onError(error); }
  };
  const offNotification = ctx.onNotification(event => { if (event.topic === "rewards-changed") void refresh(); });
  const offResync = ctx.onResync(() => { void refresh(); });
  signal.addEventListener("abort", () => { generation++; offNotification(); offResync(); }, { once: true });
  void refresh();
  return refresh;
}

export function streakUnit(streak: Pick<Streak, "mode" | "current">): string {
  const unit = streak.mode === "daily" ? "day" : "week";
  return streak.current === 1 ? unit : `${unit}s`;
}

export function statusText(streak: Streak): string {
  if (streak.mode === "weekly") {
    const { activeDays, goal, met } = streak.week;
    if (met) return `Weekly goal met: ${activeDays}/${goal} days ✓`;
    return streak.atRisk ? `Study today to keep your streak: ${activeDays}/${goal} days this week` : `${activeDays}/${goal} days this week`;
  }
  if (streak.todayActive) return "Done today ✓";
  return streak.current ? "Study today to keep your streak" : "Study today to start a streak";
}
