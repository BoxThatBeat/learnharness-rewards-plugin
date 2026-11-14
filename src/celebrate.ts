import type { PluginFrontendContext, PluginWidgetHandle } from "learnharness-plugin-api";
import { el, type AchievementView } from "./ui-common.ts";

const COLORS = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#facc15"];

function reducedMotion(doc: Document): boolean {
  try { return doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; }
}

/** A short two-note chime synthesized with WebAudio (no audio assets). */
export function chime(doc: Document): void {
  try {
    const Context = (doc.defaultView as unknown as { AudioContext?: typeof AudioContext })?.AudioContext;
    if (!Context) return;
    const audio = new Context();
    const start = audio.currentTime;
    for (const [index, frequency] of [784, 1175].entries()) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, start + index * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.12 + 0.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start + index * 0.12);
      oscillator.stop(start + index * 0.12 + 0.55);
    }
    setTimeout(() => { void audio.close().catch(() => undefined); }, 1_000);
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
  const title = unlocked.length > 1 ? "Achievements unlocked" : `Achievement unlocked: ${unlocked[0]!.title}`;
  try {
    handle = ctx.ui.openSurface({ title, background: "dimmed", content, onClose: finish }, { signal: ctx.signal }) as PluginWidgetHandle<unknown>;
  } catch {
    // No page body to cover (e.g. during navigation): fall back to a dialog.
    handle = ctx.ui.openDialog({ title, content, onClose: finish }, { signal: ctx.signal }) as PluginWidgetHandle<unknown>;
  }
}
