import type { PluginToolRenderProps } from "learnharness-plugin-api";
import { el } from "./ui-common.ts";

function details(tool: PluginToolRenderProps): { reason?: string; total?: number; sessionCount?: number; cap?: number } {
  const value = tool.result?.details ?? tool.output;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, never> : {};
}

/** Animated gold-star card for the award_star tool, rendered with plain text only. */
export function mountStarCard(container: HTMLElement, tool: PluginToolRenderProps): () => void {
  const doc = container.ownerDocument;
  const card = el(doc, "div", "rw-star-card");
  const info = details(tool);
  const input = tool.input && typeof tool.input === "object" ? tool.input as { reason?: unknown } : {};
  const reason = typeof info.reason === "string" ? info.reason : typeof input.reason === "string" ? input.reason : "";
  if (tool.state === "output-error" || tool.result?.isError) {
    card.classList.add("is-muted");
    card.append(el(doc, "span", "rw-star-card__icon", "☆"), el(doc, "span", "rw-star-card__text", tool.errorText ?? "No gold star this time."));
  } else if (tool.state !== "output-available") {
    card.classList.add("is-muted");
    card.append(el(doc, "span", "rw-star-card__icon", "⭐"), el(doc, "span", "rw-star-card__text", "Awarding a gold star…"));
  } else {
    card.classList.add("is-awarded");
    const star = el(doc, "span", "rw-star-card__icon rw-star-card__icon--pop", "⭐");
    star.setAttribute("aria-hidden", "true");
    const text = el(doc, "div", "rw-star-card__text");
    text.append(el(doc, "div", "rw-star-card__title", "Gold star!"));
    if (reason) text.append(el(doc, "div", "rw-star-card__reason", reason));
    if (typeof info.total === "number") text.append(el(doc, "div", "rw-star-card__meta", `${info.total} gold star${info.total === 1 ? "" : "s"} total`));
    card.setAttribute("role", "status");
    card.append(star, text, el(doc, "span", "rw-star-card__shine"));
  }
  container.append(card);
  const dispose = () => card.remove();
  tool.signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
