import type { StoreSizeOption } from "@aurora/measurements";

/**
 * Runs inside the current tab (via scripting.executeScript) when the user saves the page.
 * Self-contained on purpose: it is serialised and injected, so it cannot use imports.
 *
 * Finds the sizes the shop offers and whether each is in stock. First the product data shops
 * publish for search engines (JSON-LD offers with a size and availability), then the size
 * picker on the page: a select or a group of buttons whose labels look like sizes, inside an
 * element that mentions "size". Returns at most 40 sizes in the shop's order.
 */
export function readSizeOptionsInPage(): StoreSizeOption[] {
  const MAX = 40;
  const SIZE_LABEL =
    /^(?:(?:eu|uk|us|fr|it)\s*)?(?:x{0,4}s|m|x{0,4}l|[2-6]xl|[2-6]x|\d{1,3}(?:[.,]5)?(?:\s*[/-]\s*\d{1,3})?|w\d{2}(?:\s*l\d{2})?|one size|onesize|os)$/i;
  const SOLD_OUT = /sold\s*out|out of stock|unavailable|not available|loppu|ei saatavilla|slut|ausverkauft|épuisé|agotado/i;
  const UNAVAILABLE_CLASS = /disabled|unavailable|out-?of-?stock|sold-?out|not-?available|inactive/i;
  const SIZE_HINT = /size|größe|groesse|storlek|koko|taille|talla|taglia|maat/i;

  const clean = (text: string) => text.replace(SOLD_OUT, "").replace(/[-–:,()]+\s*$/, "").replace(/\s+/g, " ").trim();
  const unique = (sizes: StoreSizeOption[]) => {
    const seen = new Map<string, StoreSizeOption>();
    for (const size of sizes) {
      const key = size.label.toUpperCase();
      const known = seen.get(key);
      // The same size listed twice (e.g. per colour): in stock if any listing is.
      if (!known) seen.set(key, size);
      else if (size.available === true) known.available = true;
    }
    return [...seen.values()].slice(0, MAX);
  };

  // 1. JSON-LD product data.
  const fromData: StoreSizeOption[] = [];
  const availability = (value: unknown): boolean | null => {
    const text = String(value ?? "");
    if (/InStock|LimitedAvailability|OnlineOnly|PreOrder/i.test(text)) return true;
    if (/OutOfStock|SoldOut|Discontinued/i.test(text)) return false;
    return null;
  };
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    const record = node as Record<string, unknown>;
    const size = record.size ?? (record.additionalProperty as { name?: string; value?: unknown } | undefined)?.value;
    const label = typeof size === "string" ? clean(size) : typeof size === "object" && size ? clean(String((size as { name?: unknown }).name ?? "")) : "";
    if (label && label.length <= 40) {
      const offers = record.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      fromData.push({ label, available: availability(record.availability ?? offer?.availability) });
    }
    for (const key of ["@graph", "hasVariant", "offers", "model", "isVariantOf"]) visit(record[key], depth + 1);
  };
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visit(JSON.parse(script.textContent ?? ""), 0);
    } catch {
      // Not valid JSON: ignore it.
    }
  }
  if (fromData.length > 0) return unique(fromData);

  // 2. The size picker on the page.
  const mentionsSize = (el: Element | null): boolean => {
    for (let node = el, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      const attrs = [node.id, node.getAttribute("class"), node.getAttribute("name"), node.getAttribute("aria-label"), node.getAttribute("data-testid")];
      if (attrs.some((a) => a && SIZE_HINT.test(a))) return true;
      const legend = node.querySelector(":scope > legend, :scope > label");
      if (legend && SIZE_HINT.test(legend.textContent ?? "")) return true;
    }
    return false;
  };
  const unavailable = (el: Element): boolean => {
    const input = el.matches("input, option, button") ? el : el.querySelector("input, button");
    if (input && (input as HTMLInputElement).disabled) return true;
    if (el.getAttribute("aria-disabled") === "true" || input?.getAttribute("aria-disabled") === "true") return true;
    if (UNAVAILABLE_CLASS.test(el.getAttribute("class") ?? "") || UNAVAILABLE_CLASS.test(input?.getAttribute("class") ?? "")) return true;
    if (SOLD_OUT.test(el.textContent ?? "") || SOLD_OUT.test(el.getAttribute("aria-label") ?? "")) return true;
    return getComputedStyle(el).textDecorationLine.includes("line-through");
  };

  const groups: StoreSizeOption[][] = [];
  for (const select of Array.from(document.querySelectorAll("select"))) {
    if (!mentionsSize(select)) continue;
    const sizes = Array.from(select.options)
      .map((option) => ({ label: clean(option.textContent ?? ""), available: !unavailable(option) }))
      .filter((s) => SIZE_LABEL.test(s.label));
    if (sizes.length >= 2) groups.push(sizes);
  }
  const candidates = Array.from(document.querySelectorAll("button, label, [role='radio'], [role='option'], li, a"));
  const byParent = new Map<Element, StoreSizeOption[]>();
  for (const el of candidates) {
    const parent = el.parentElement;
    if (!parent || el.getClientRects().length === 0) continue;
    const label = clean((el as HTMLElement).innerText ?? el.textContent ?? "");
    if (!SIZE_LABEL.test(label) || !mentionsSize(el)) continue;
    const list = byParent.get(parent) ?? [];
    list.push({ label, available: !unavailable(el) });
    byParent.set(parent, list);
  }
  groups.push(...[...byParent.values()].filter((g) => g.length >= 2));
  const best = groups.sort((a, b) => b.length - a.length)[0];
  return best ? unique(best) : [];
}

export async function readSizeOptions(tabId: number): Promise<StoreSizeOption[]> {
  try {
    const [first] = await browser.scripting.executeScript({ target: { tabId }, func: readSizeOptionsInPage });
    return (first?.result as StoreSizeOption[] | undefined) ?? [];
  } catch {
    return [];
  }
}
