import type { PluginFrontendContext } from "learnharness-plugin-api";
import { celebrate } from "./celebrate.ts";
import { setupReminders } from "./reminders.ts";
import { STAR_TOOL_NAME } from "./scan.ts";
import { mountSettings } from "./settings.ts";
import { mountStarCard } from "./star-card.ts";
import type { StateView } from "./ui-common.ts";
import { mountRewardsView } from "./view.ts";

const TROPHY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';

export function activate(ctx: PluginFrontendContext): () => void {
  const registrations: (() => void)[] = [];
  const openRewards = () => ctx.app.openView("rewards");
  registrations.push(ctx.registerView({ id: "rewards", name: "Rewards", mount: (container, signal) => mountRewardsView(ctx, container, signal) }));
  registrations.push(ctx.registerAction({ id: "open", name: "Rewards", icon: TROPHY_ICON, run: openRewards }));
  registrations.push(ctx.placeAction({ id: "open-sidebar", actionId: "open", location: "sidebar" }));
  registrations.push(ctx.registerSettings((container: HTMLElement, signal: AbortSignal) => mountSettings(ctx, container, signal)));
  registrations.push(ctx.registerToolRenderer({ toolName: STAR_TOOL_NAME, mount: mountStarCard }));
  registrations.push(setupReminders(ctx, openRewards));

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
      celebrate(ctx, fresh, { sound: view.settings.celebrations.sound, onDone: markSeen });
    } catch { /* Celebrations are best-effort. */ }
    finally { busy = false; }
  }
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
