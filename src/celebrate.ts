import type { PluginFrontendContext, PluginWidgetHandle } from "learnharness-plugin-api";
import { el, type AchievementView } from "./ui-common.ts";

const COLORS = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#facc15"];

function reducedMotion(doc: Document): boolean {
  try { return doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; }
}

export type Tone = "achievement" | "streak";
/** Rising major arpeggio for unlocks; a short two-note lift for a streak tick. */
const TONES: Record<Tone, { notes: number[]; gap: number; ring: number }> = {
  achievement: { notes: [523.25, 659.25, 783.99, 1046.5], gap: 0.085, ring: 1.4 },
  streak: { notes: [783.99, 1046.5], gap: 0.11, ring: 0.9 },
};
/** Bell partials: [frequency multiple, level]. Higher partials are quieter and fade sooner. */
const PARTIALS: [number, number][] = [[1, 0.2], [2, 0.06], [3, 0.025]];

/** A soft bell-like chime synthesized with WebAudio (no audio assets). */
export function chime(doc: Document, tone: Tone = "achievement"): void {
  try {
    const Context = (doc.defaultView as unknown as { AudioContext?: typeof AudioContext })?.AudioContext;
    if (!Context) return;
    const audio = new Context();
    void audio.resume?.().catch(() => undefined);
    const { notes, gap, ring } = TONES[tone];
    const master = audio.createGain();
    master.gain.value = 0.55;
    master.connect(audio.destination);
    const start = audio.currentTime + 0.03;
    notes.forEach((frequency, index) => {
      const at = start + index * gap;
      const length = index === notes.length - 1 ? ring : 0.5;
      for (const [multiple, level] of PARTIALS) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * multiple;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(level, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + length / multiple);
        oscillator.connect(gain).connect(master);
        oscillator.start(at);
        oscillator.stop(at + length / multiple + 0.05);
      }
    });
    setTimeout(() => { void audio.close().catch(() => undefined); }, (notes.length * gap + ring + 0.5) * 1_000);
  } catch { /* Audio is optional. */ }
}

export function confetti(container: HTMLElement, count = 90): void {
  const doc = container.ownerDocument;
  if (reducedMotion(doc)) return;
  const layer = el(doc, "div", "rw-confetti");
  layer.setAttribute("aria-hidden", "true");
  for (let index = 0; index < count; index++) {
    const piece = el(doc, "span", "rw-confetti__piece");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[index % COLORS.length]!;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    piece.style.setProperty("--rw-drift", `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty("--rw-spin", `${(Math.random() - 0.5) * 1080}deg`);
    layer.append(piece);
  }
  container.append(layer);
}

/** Celebration overlay for newly unlocked achievements. Closes on click, Escape (host
 * surface) or after ~4 s; `onDone` runs exactly once either way. */
export function celebrate(ctx: PluginFrontendContext, unlocked: AchievementView[], options: { sound: boolean; onDone: () => void }): void {
  if (!unlocked.length) { options.onDone(); return; }
  let finished = false;
  let handle: PluginWidgetHandle<unknown> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    options.onDone();
  };
  const content = (container: HTMLElement, signal: AbortSignal) => {
    const doc = container.ownerDocument;
    const stage = el(doc, "div", "rw-celebrate");
    stage.tabIndex = -1;
    stage.setAttribute("data-plugin-initial-focus", "");
    container.append(stage);
    confetti(stage);
    const card = el(doc, "div", "rw-celebrate__card");
    card.setAttribute("role", "status");
    const shown = unlocked.slice(0, 4);
    card.append(el(doc, "div", "rw-celebrate__kicker", shown.length > 1 ? "Achievements unlocked!" : "Achievement unlocked!"));
    for (const achievement of shown) {
      const row = el(doc, "div", "rw-celebrate__badge");
      row.append(el(doc, "span", "rw-celebrate__icon", achievement.icon));
      const text = el(doc, "div");
      text.append(el(doc, "div", "rw-celebrate__title", achievement.title), el(doc, "div", "rw-celebrate__description", achievement.description));
      row.append(text);
      card.append(row);
    }
    if (unlocked.length > shown.length) card.append(el(doc, "div", "rw-hint", `+${unlocked.length - shown.length} more — see Rewards`));
    card.append(el(doc, "div", "rw-hint", "Click anywhere to continue"));
    stage.append(card);
    if (options.sound) chime(doc);
    const close = () => { handle?.dispose(); finish(); };
    stage.addEventListener("click", close);
    const timer = setTimeout(close, 4_500);
    signal.addEventListener("abort", () => { clearTimeout(timer); finish(); }, { once: true });
    return () => { clearTimeout(timer); stage.remove(); };
  };
  open(ctx, unlocked.length > 1 ? "Achievements unlocked" : `Achievement unlocked: ${unlocked[0]!.title}`, content, finish, value => { handle = value; });
}

function open(ctx: PluginFrontendContext, title: string, content: (container: HTMLElement, signal: AbortSignal) => () => void, finish: () => void, keep: (handle: PluginWidgetHandle<unknown>) => void): void {
  try {
    try {
      keep(ctx.ui.openSurface({ title, background: "dimmed", content, onClose: finish }, { signal: ctx.signal }) as PluginWidgetHandle<unknown>);
    } catch {
      // No page body to cover (e.g. during navigation): fall back to a dialog.
      keep(ctx.ui.openDialog({ title, content, onClose: finish }, { signal: ctx.signal }) as PluginWidgetHandle<unknown>);
    }
  } catch { finish(); }
}

/** Brief overlay when the streak goes up: the count rolls from the old number to the new
 * one beside the flame. Closes itself after ~3 s, or on click/Escape; `onDone` runs once. */
export function streakUp(ctx: PluginFrontendContext, streak: { current: number; mode: "daily" | "weekly" }, options: { sound: boolean; onDone: () => void }): void {
  let finished = false;
  let handle: PluginWidgetHandle<unknown> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    options.onDone();
  };
  const unit = streak.mode === "daily" ? "day" : "week";
  const content = (container: HTMLElement, signal: AbortSignal) => {
    const doc = container.ownerDocument;
    const stage = el(doc, "div", "rw-celebrate");
    stage.tabIndex = -1;
    stage.setAttribute("data-plugin-initial-focus", "");
    const card = el(doc, "div", "rw-celebrate__card rw-streak-up");
    card.setAttribute("role", "status");
    const number = el(doc, "div", "rw-streak-up__number");
    number.setAttribute("aria-label", String(streak.current));
    const roll = el(doc, "div", "rw-streak-up__roll");
    roll.setAttribute("aria-hidden", "true");
    roll.append(el(doc, "span", undefined, String(streak.current - 1)), el(doc, "span", undefined, String(streak.current)));
    number.append(roll);
    card.append(
      el(doc, "div", "rw-celebrate__kicker", streak.current === 1 ? "Streak started!" : streak.mode === "daily" ? "Streak extended!" : "Weekly goal met!"),
      el(doc, "div", "rw-streak-up__flame", "🔥"),
      number,
      el(doc, "div", "rw-streak-up__label", `${unit} streak`),
    );
    stage.append(card);
    container.append(stage);
    // The sound lands with the number roll (see rw-roll's delay in styles.css).
    const sound = options.sound ? setTimeout(() => chime(doc, "streak"), reducedMotion(doc) ? 0 : 550) : undefined;
    const close = () => { handle?.dispose(); finish(); };
    stage.addEventListener("click", close);
    const timer = setTimeout(close, 3_000);
    const stop = () => { clearTimeout(timer); clearTimeout(sound); };
    signal.addEventListener("abort", () => { stop(); finish(); }, { once: true });
    return () => { stop(); stage.remove(); };
  };
  open(ctx, `${streak.current}-${unit} streak`, content, finish, value => { handle = value; });
}
