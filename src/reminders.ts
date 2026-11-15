import type { PluginFrontendContext, PluginWidgetHandle } from "learnharness-plugin-api";
import { localDate } from "./dates.ts";
import { el, statusText, type StateView } from "./ui-common.ts";

/** Should a reminder fire now? Pure for testing. */
export function reminderDue(view: Pick<StateView, "settings" | "streak" | "reminderClaimed">, now: Date): boolean {
  const { reminder } = view.settings;
  if (!reminder.enabled) return false;
  const today = localDate(now);
  if (view.reminderClaimed === today) return false;
  const [hours, minutes] = reminder.time.split(":").map(Number) as [number, number];
  if (now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes) return false;
  const { streak } = view;
  if (streak.todayActive) return false;
  return streak.mode === "daily" ? true : !streak.week.met;
}

/** Minute timer per window; the backend's claim ensures only one window reminds per day. */
export function setupReminders(ctx: PluginFrontendContext, openRewards: () => void, now: () => Date = () => new Date()): () => void {
  let latest: StateView | null = null;
  let checking = false;
  let dialog: PluginWidgetHandle<unknown> | undefined;

  async function check() {
    if (checking || ctx.signal.aborted) return;
    checking = true;
    try {
      if (latest && !reminderDue(latest, now())) return;
      latest = await ctx.call<StateView>("get-state");
      if (!reminderDue(latest, now())) return;
      const { claimed } = await ctx.call<{ claimed: boolean }>("claim-reminder", { date: localDate(now()) });
      if (!claimed || ctx.signal.aborted) return;
      const text = statusText(latest.streak);
      const streak = latest.streak.current ? ` You're on a ${latest.streak.current}-${latest.streak.mode === "daily" ? "day" : "week"} streak.` : "";
      dialog?.dispose();
      dialog = ctx.ui.openDialog({
        title: "Study reminder",
        content: (container, signal) => {
          const box = el(container.ownerDocument, "div", "rw-reminder");
          box.append(el(container.ownerDocument, "h2", undefined, "🔥 Time to learn"), el(container.ownerDocument, "p", undefined, `${text}.${streak}`));
          const actions = el(container.ownerDocument, "div", "rw-actions");
          box.append(actions);
          container.append(box);
          const buttons = [
            ctx.ui.mountButton(actions, { label: "Open Rewards", size: "sm", onClick: () => { dialog?.dispose(); openRewards(); } }, { signal }),
            ctx.ui.mountButton(actions, { label: "Later", variant: "ghost", size: "sm", onClick: () => dialog?.dispose() }, { signal }),
          ];
          return () => { for (const button of buttons) button.dispose(); box.remove(); };
        },
      }, { signal: ctx.signal }) as PluginWidgetHandle<unknown>;
    } catch { /* Try again next minute. */ }
    finally { checking = false; }
  }

  const offNotification = ctx.onNotification(event => { if (event.topic === "rewards-changed") latest = null; });
  const timer = setInterval(() => { void check(); }, 60_000);
  const first = setTimeout(() => { void check(); }, 5_000);
  return () => {
    clearInterval(timer);
    clearTimeout(first);
    offNotification();
    dialog?.dispose();
  };
}
