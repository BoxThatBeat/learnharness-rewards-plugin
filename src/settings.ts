import type { PluginFrontendContext, PluginSettingsRow, PluginWidgetHandle } from "learnharness-plugin-api";
import type { Settings } from "./state.ts";
import { el, message, subscribeState, type StateView } from "./ui-common.ts";

export function mountSettings(ctx: PluginFrontendContext, container: HTMLElement, signal: AbortSignal): () => void {
  const doc = container.ownerDocument;
  const root = el(doc, "div", "rw-settings");
  container.append(root);
  const widgets: PluginWidgetHandle<unknown>[] = [];
  let view: StateView | null = null;

  const error = el(doc, "p", "rw-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const rowsSlot = el(doc, "div");
  const actions = el(doc, "div", "rw-actions");
  const status = el(doc, "p", "rw-hint");
  status.setAttribute("role", "status");
  root.append(error, rowsSlot, actions, status);

  async function save(patch: (settings: Settings) => Settings) {
    if (!view) return;
    const next = await ctx.call<StateView>("save-settings", { settings: patch(structuredClone(view.settings)) });
    apply(next);
  }

  function rows(settings: Settings, disabled: boolean): PluginSettingsRow[] {
    return [
      {
        key: "streak-mode", type: "dropdown", label: "Streak", disabled,
        description: "Daily: study every day. Weekly: meet a goal of active days each Monday–Sunday week.",
        value: settings.streakMode,
        options: [{ value: "daily", label: "Daily streak" }, { value: "weekly", label: "Weekly streak" }],
        onChange: value => save(s => ({ ...s, streakMode: value === "weekly" ? "weekly" : "daily" })),
      },
      {
        key: "weekly-goal", type: "number", label: "Weekly goal (active days)", min: 1, max: 7, step: 1,
        disabled: disabled || settings.streakMode !== "weekly",
        description: "How many active days a week needs to count toward a weekly streak.",
        value: settings.weeklyGoal,
        onChange: value => save(s => ({ ...s, weeklyGoal: value })),
      },
      {
        key: "reminder", type: "toggle", label: "Daily reminder", disabled,
        description: "While LearnHarness is open, remind me at the time below if my streak needs activity today.",
        value: settings.reminder.enabled,
        onChange: value => save(s => ({ ...s, reminder: { ...s.reminder, enabled: value } })),
      },
      {
        key: "reminder-time", type: "text", label: "Reminder time", disabled: disabled || !settings.reminder.enabled,
        description: "24-hour time, e.g. 19:00.",
        value: settings.reminder.time,
        validate: value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? undefined : "Use HH:MM, e.g. 19:00.",
        onChange: value => save(s => ({ ...s, reminder: { ...s.reminder, time: value } })),
      },
      {
        key: "celebrations", type: "toggle", label: "Celebrations", disabled,
        description: "A streak animation when your streak goes up, and confetti when you unlock an achievement.",
        value: settings.celebrations.enabled,
        onChange: value => save(s => ({ ...s, celebrations: { ...s.celebrations, enabled: value } })),
      },
      {
        key: "sound", type: "toggle", label: "Celebration sound", disabled: disabled || !settings.celebrations.enabled,
        description: "A short chime with each celebration.",
        value: settings.celebrations.sound,
        onChange: value => save(s => ({ ...s, celebrations: { ...s.celebrations, sound: value } })),
      },
      {
        key: "teacher", type: "toggle", label: "Teacher awareness", disabled,
        description: "Let the teacher see your streak and milestones, and award gold stars for excellent work.",
        value: settings.teacher.enabled,
        onChange: value => save(s => ({ ...s, teacher: { ...s.teacher, enabled: value } })),
      },
      {
        key: "star-cap", type: "number", label: "Teacher stars per session", min: 0, max: 20, step: 1,
        disabled: disabled || !settings.teacher.enabled,
        description: "How many gold stars the teacher may award in one session. 0 turns gold stars off.",
        value: settings.teacher.starCap,
        onChange: value => save(s => ({ ...s, teacher: { ...s.teacher, starCap: value } })),
      },
    ];
  }
  let settingsRows: PluginWidgetHandle<{ rows: PluginSettingsRow[] }> | undefined;

  const button = (label: string, onClick: () => void | Promise<void>, variant: "outline" | "ghost" = "outline") =>
    widgets.push(ctx.ui.mountButton(actions, { label, variant, size: "sm", onClick }, { signal }) as PluginWidgetHandle<unknown>);
  button("Rebuild from history", async () => {
    status.textContent = "Reading your learning history…";
    try { apply(await ctx.call<StateView>("rescan")); status.textContent = "Rebuilt from your sessions."; }
    catch (failure) { status.textContent = message(failure); }
  }, "ghost");

  function apply(next: StateView) {
    if (signal.aborted) return;
    view = next;
    error.hidden = !next.loadError;
    error.textContent = next.loadError ?? "";
    const schema = { rows: rows(next.settings, Boolean(next.loadError)) };
    if (!settingsRows) {
      settingsRows = ctx.ui.mountSettingsRows(rowsSlot, schema, { signal });
      widgets.push(settingsRows as PluginWidgetHandle<unknown>);
    } else settingsRows.update(schema);
  }

  subscribeState(ctx, signal, apply, failure => { error.hidden = false; error.textContent = message(failure); });
  return () => {
    for (const widget of widgets) widget.dispose();
    root.remove();
  };
}
