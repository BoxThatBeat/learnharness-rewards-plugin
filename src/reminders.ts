import type { PluginFrontendContext, PluginWidgetHandle } from "learnharness-plugin-api";
import { localDate } from "./dates.ts";
import { el, statusText, type StateView } from "./ui-common.ts";

type NotificationApi = { permission: string; requestPermission(): Promise<string> } & (new (title: string, options?: { body?: string; silent?: boolean }) => unknown);

function api(doc: Document): NotificationApi | null {
  const candidate = (doc.defaultView as unknown as { Notification?: NotificationApi } | null)?.Notification;
  return typeof candidate === "function" ? candidate : null;
}

export function notificationSupport(doc: Document): "unsupported" | "granted" | "denied" | "default" {
  const Notification = api(doc);
  if (!Notification) return "unsupported";
  return Notification.permission === "granted" || Notification.permission === "denied" ? Notification.permission : "default";
}

/** Show a desktop notification if the window supports it. Asks for permission only when
 * `askPermission` (a direct user action); otherwise uses an existing grant. */
export async function showDesktopNotification(doc: Document, title: string, body: string, askPermission: boolean): Promise<boolean> {
  const Notification = api(doc);
  if (!Notification) return false;
  try {
    let permission = Notification.permission;
    if (permission === "default" && askPermission) permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
    new Notification(title, { body });
    return true;
  } catch { return false; }
}

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
  const doc = document;

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
      if (latest.settings.reminder.os) await showDesktopNotification(doc, "Time to learn", `${text}.${streak}`, false);
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
