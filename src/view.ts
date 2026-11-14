import type { PluginFrontendContext, PluginWidgetHandle } from "learnharness-plugin-api";
import { addDays, weekday } from "./dates.ts";
import type { Group, StreakRun } from "./rewards.ts";
import { el, iconButton, message, progressBar, statusText, streakUnit, subscribeState, type StateView } from "./ui-common.ts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GROUPS: [Group, string][] = [["streak", "Streaks"], ["concepts", "Concepts"], ["stars", "Gold stars"], ["questions", "Questions"], ["practice", "Practice"], ["sessions", "Sessions"], ["fun", "Just for fun"]];

const monthOf = (date: string) => date.slice(0, 7);
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Streak-line segment for one calendar cell, or null when the day is outside every run. */
export function lineSegment(runs: readonly StreakRun[], date: string): { start: boolean; end: boolean; frozen: boolean } | null {
  for (const run of runs) {
    if (date < run.start || date > run.end) continue;
    return { start: date === run.start, end: date === run.end, frozen: run.frozen.includes(date) };
  }
  return null;
}

export function mountRewardsView(ctx: PluginFrontendContext, container: HTMLElement, signal: AbortSignal): () => void {
  const doc = container.ownerDocument;
  const root = el(doc, "div", "rw-view");
  container.append(root);
  const widgets: PluginWidgetHandle<unknown>[] = [];
  let view: StateView | null = null;
  let tab: "calendar" | "achievements" = "calendar";
  let month = "";

  const error = el(doc, "p", "rw-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const header = el(doc, "div", "rw-header");
  const tabs = el(doc, "div", "rw-tabs");
  tabs.setAttribute("role", "tablist");
  const tabButtons = (["calendar", "achievements"] as const).map(value => {
    const button = el(doc, "button", "rw-tab", value === "calendar" ? "Calendar" : "Achievements");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => { tab = value; render(); });
    tabs.append(button);
    return { value, button };
  });
  const body = el(doc, "div", "rw-body");
  root.append(error, header, tabs, body);

  function renderHeader(current: StateView) {
    const { streak, totals } = current;
    header.replaceChildren();
    const hero = el(doc, "div", "rw-hero");
    const flame = el(doc, "div", `rw-flame${streak.current ? "" : " is-cold"}${streak.atRisk && streak.current ? " is-at-risk" : ""}`);
    flame.append(el(doc, "span", "rw-flame__icon", "🔥"), el(doc, "span", "rw-flame__count", String(streak.current)));
    const summary = el(doc, "div", "rw-hero__summary");
    summary.append(
      el(doc, "div", "rw-hero__title", `${streak.current} ${streakUnit(streak)} streak`),
      el(doc, "div", `rw-hero__status${streak.atRisk ? " is-at-risk" : ""}`, statusText(streak)),
      el(doc, "div", "rw-hint", [
        `Best: ${streak.longest} ${streak.mode === "daily" ? "days" : "weeks"}`,
        `❄️ ${streak.freezes} freeze${streak.freezes === 1 ? "" : "s"}`,
        `⭐ ${totals.stars} stars`,
        `${totals.activeDays} active days`,
      ].join(" · ")),
    );
    hero.append(flame, summary);
    if (streak.mode === "weekly") summary.append(progressBar(doc, streak.week.activeDays, streak.week.goal, "This week's progress"));
    header.append(hero);
    if (current.nextMilestones.length) {
      const next = el(doc, "div", "rw-next");
      next.append(el(doc, "div", "rw-label", "Next milestones"));
      for (const item of current.nextMilestones) {
        const row = el(doc, "div", "rw-next__item");
        row.append(el(doc, "span", "rw-next__icon", item.icon), el(doc, "span", "rw-next__title", item.title), progressBar(doc, item.progress, item.threshold, `${item.title} progress`), el(doc, "span", "rw-hint", `${item.progress}/${item.threshold}`));
        next.append(row);
      }
      header.append(next);
    }
  }

  function renderCalendar(current: StateView) {
    const active = new Set(current.activeDates);
    const { streak } = current;
    month ||= monthOf(current.today);
    const nav = el(doc, "div", "rw-month-nav");
    nav.append(
      iconButton(doc, "Previous month", "‹", () => { month = shiftMonth(month, -1); render(); }),
      el(doc, "h3", "rw-month", monthLabel(month)),
      iconButton(doc, "Next month", "›", () => { month = shiftMonth(month, 1); render(); }),
    );
    const todayButton = el(doc, "button", "rw-link", "Today");
    todayButton.type = "button";
    todayButton.addEventListener("click", () => { month = monthOf(current.today); render(); });
    nav.append(todayButton);

    const grid = el(doc, "div", "rw-grid");
    for (const name of WEEKDAYS) grid.append(el(doc, "div", "rw-grid__weekday", name));
    const first = `${month}-01`;
    let date = addDays(first, -((weekday(first) + 6) % 7));
    const pendingToday = streak.mode === "daily" && streak.current > 0 && !streak.todayActive;
    for (let cell = 0; cell < 42; cell++, date = addDays(date, 1)) {
      if (cell === 35 && monthOf(date) !== month) break;
      const day = el(doc, "div", "rw-day");
      day.dataset.date = date;
      if (monthOf(date) !== month) day.classList.add("is-outside");
      if (date === current.today) day.classList.add("is-today");
      if (date > current.today) day.classList.add("is-future");
      const labelParts: string[] = [formatDate(date)];
      const top = el(doc, "div", "rw-day__top");
      top.append(el(doc, "span", "rw-day__number", String(Number(date.slice(8)))));
      const stars = current.starsByDate[date] ?? 0;
      if (stars) { top.append(el(doc, "span", "rw-day__stars", `⭐${stars > 1 ? stars : ""}`)); labelParts.push(`${stars} star${stars === 1 ? "" : "s"}`); }
      day.append(top);
      // The streak line: a bar through every day inside a run, capped at run ends, ice-blue when frozen.
      const segment = lineSegment(streak.runs, date);
      const line = el(doc, "div", "rw-line");
      if (segment) {
        line.classList.add("is-on");
        if (segment.start) line.classList.add("is-start");
        if (segment.end) line.classList.add("is-end");
        if (segment.frozen) { line.classList.add("is-frozen"); labelParts.push("streak freeze used"); }
        else labelParts.push("in a streak");
      } else if (pendingToday && date === current.today) {
        line.classList.add("is-pending");
        labelParts.push("study today to extend your streak");
      }
      day.append(line);
      if (active.has(date)) { day.classList.add("is-active"); day.append(el(doc, "span", "rw-day__dot")); labelParts.push("active"); }
      if (streak.mode === "weekly" && weekday(date) === 0) {
        const weekCount = Array.from({ length: 7 }, (_, index) => addDays(date, index - 6)).filter(day => active.has(day)).length;
        if (weekCount) day.append(el(doc, "span", `rw-day__week${weekCount >= streak.week.goal ? " is-met" : ""}`, `${weekCount}/${streak.week.goal}`));
      }
      day.setAttribute("aria-label", labelParts.join(", "));
      grid.append(day);
    }
    const legend = el(doc, "div", "rw-legend");
    const swatch = (className: string, text: string) => {
      const item = el(doc, "span", "rw-legend__item");
      item.append(el(doc, "span", `rw-legend__swatch ${className}`), el(doc, "span", undefined, text));
      return item;
    };
    legend.append(swatch("is-line", "Streak"), swatch("is-frozen", "Freeze used"), swatch("is-dot", "Active day"), swatch("is-pending", "Today, not yet"));
    body.append(nav, grid, legend);
  }

  function renderAchievements(current: StateView) {
    const unlocked = current.achievements.filter(item => item.unlockedAt).length;
    body.append(el(doc, "p", "rw-hint", `${unlocked} of ${current.achievements.length} achievements unlocked`));
    for (const [group, title] of GROUPS) {
      const items = current.achievements.filter(item => item.group === group);
      if (!items.length) continue;
      const section = el(doc, "section", "rw-section");
      section.append(el(doc, "h3", undefined, title));
      const cabinet = el(doc, "div", "rw-cabinet");
      for (const item of items) {
        const badge = el(doc, "div", `rw-badge${item.unlockedAt ? " is-unlocked" : ""}`);
        badge.append(el(doc, "div", "rw-badge__icon", item.icon), el(doc, "div", "rw-badge__title", item.title), el(doc, "div", "rw-badge__description", item.description));
        if (item.unlockedAt) badge.append(el(doc, "div", "rw-badge__date", formatDate(item.unlockedAt)));
        else if (item.threshold > 1) badge.append(progressBar(doc, item.progress, item.threshold, `${item.title} progress`), el(doc, "div", "rw-hint", `${item.progress} / ${item.threshold}`));
        badge.setAttribute("aria-label", `${item.title}: ${item.unlockedAt ? `unlocked ${formatDate(item.unlockedAt)}` : `locked, ${item.progress} of ${item.threshold}`}`);
        cabinet.append(badge);
      }
      section.append(cabinet);
      body.append(section);
    }
  }

  function render() {
    for (const widget of widgets.splice(0)) widget.dispose();
    const current = view;
    if (!current) return;
    error.hidden = !current.loadError;
    error.textContent = current.loadError ?? "";
    for (const { value, button } of tabButtons) button.setAttribute("aria-selected", String(tab === value));
    renderHeader(current);
    body.replaceChildren();
    if (tab === "calendar") renderCalendar(current);
    else renderAchievements(current);
    if (current.scanning) body.append(el(doc, "p", "rw-hint", "Reading your learning history…"));
  }

  subscribeState(ctx, signal, next => { view = next; render(); }, failure => { error.hidden = false; error.textContent = message(failure); });
  return () => {
    for (const widget of widgets) widget.dispose();
    root.remove();
  };
}
