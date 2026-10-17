import type { Grid } from "@aurora/measurements";

export interface PageTable {
  rows: Grid;
  visible: boolean;
  /** Short text just before the table (e.g. "...actual measurements of the product"). */
  context: string;
  /** Actually on screen right now (not just rendered off-screen or behind a closed panel). */
  onScreen: boolean;
}

/**
 * Runs inside the current tab (via scripting.executeScript) when the popup opens.
 * Self-contained on purpose: it is serialised and injected, so it cannot use imports.
 * Returns the text of table-like elements only; nothing else on the page is read.
 */
export function readTablesInPage(): PageTable[] {
  const MAX_TABLES = 40;
  const MAX_ROWS = 60;
  const MAX_CELLS = 20;
  const text = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? "").trim().slice(0, 120);
  const isVisible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
  const isOnScreen = (el: Element) => {
    const box = el.getBoundingClientRect();
    const inViewport =
      box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 &&
      box.top < window.innerHeight && box.left < window.innerWidth;
    const shown = typeof (el as HTMLElement).checkVisibility === "function"
      ? (el as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })
      : true;
    return inViewport && shown;
  };
  // Text of the elements just before the table (and before its containers), which usually
  // says whether the chart is body or garment measurements.
  const longText = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? "").trim().slice(0, 300);
  const contextOf = (el: Element) => {
    let context = "";
    let node: Element | null = el;
    for (let depth = 0; depth < 4 && node && context.length < 600; depth++) {
      let sibling = node.previousElementSibling;
      while (sibling && context.length < 600) {
        if (!sibling.querySelector("table")) context = `${longText(sibling)} ${context}`;
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    const caption = el.querySelector("caption");
    return `${caption ? longText(caption) : ""} ${context}`.replace(/\s+/g, " ").trim().slice(0, 600);
  };

  const tables: PageTable[] = [];
  for (const table of Array.from(document.querySelectorAll("table")).slice(0, MAX_TABLES)) {
    const rows = Array.from(table.rows)
      .slice(0, MAX_ROWS)
      .map((row) => Array.from(row.cells).slice(0, MAX_CELLS).map(text));
    if (rows.length > 1) tables.push({ rows, visible: isVisible(table), context: contextOf(table), onScreen: isOnScreen(table) });
  }
  // Size guides built from ARIA roles instead of <table>.
  for (const grid of Array.from(document.querySelectorAll('[role="table"], [role="grid"]')).slice(0, MAX_TABLES)) {
    if (grid.tagName === "TABLE") continue;
    const rows = Array.from(grid.querySelectorAll('[role="row"]'))
      .slice(0, MAX_ROWS)
      .map((row) =>
        Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]'))
          .slice(0, MAX_CELLS)
          .map(text),
      );
    if (rows.length > 1) tables.push({ rows, visible: isVisible(grid), context: contextOf(grid), onScreen: isOnScreen(grid) });
  }
  return tables;
}

/** Read size-chart candidates from a tab. Returns [] where pages can't be read (e.g. browser pages). */
export async function readTables(tabId: number): Promise<PageTable[]> {
  try {
    const [first] = await browser.scripting.executeScript({ target: { tabId }, func: readTablesInPage });
    return (first?.result as PageTable[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * Runs in the current tab when saving: the product image the page advertises for sharing
 * (og:image / twitter:image), else the largest visible image. Self-contained (injected).
 */
export function readProductImageInPage(): string | null {
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content;
  const candidate =
    meta('meta[property="og:image"]') ??
    meta('meta[name="og:image"]') ??
    meta('meta[name="twitter:image"]') ??
    Array.from(document.images)
      .filter((img) => img.naturalWidth >= 300 && img.getClientRects().length > 0)
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0]?.currentSrc;
  if (!candidate) return null;
  try {
    const url = new URL(candidate, location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.slice(0, 2048) : null;
  } catch {
    return null;
  }
}

export async function readProductImage(tabId: number): Promise<string | null> {
  try {
    const [first] = await browser.scripting.executeScript({ target: { tabId }, func: readProductImageInPage });
    return (first?.result as string | null | undefined) ?? null;
  } catch {
    return null;
  }
}
