/**
 * Injected only into shops the user has opted in to. Reads size-chart tables, asks the
 * extension background for a suggestion, and shows a small dismissible card.
 *
 * Never changes the shop's own content and never receives measurement values: the background
 * replies with just the size label and which measurements it was based on.
 */
import { FIELD_INFO, SIZE_CHART_HINT } from "@aurora/measurements";

import type { SuggestRequest, SuggestResponse } from "@/lib/messages";
import { readTablesInPage } from "@/lib/read-tables";

const RESCAN_DELAY_MS = 800;
const WATCH_FOR_MS = 120_000; // keep watching for a size guide this long after each navigation

declare global {
  interface Window {
    __auroraSizeCard?: boolean;
  }
}

export default defineUnlistedScript(() => {
  if (window.__auroraSizeCard) return; // already running on this page
  window.__auroraSizeCard = true;

  let host: HTMLElement | null = null;
  let shownFor: string | null = null; // "url|label" currently shown or dismissed
  let dismissed = false;
  let watchUntil = Date.now() + WATCH_FOR_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastUrl = location.href;

  function hasCandidateTable(): boolean {
    return Array.from(document.querySelectorAll('table, [role="table"], [role="grid"]')).some((el) =>
      SIZE_CHART_HINT.test(el.textContent ?? ""),
    );
  }

  async function scan(): Promise<void> {
    if (location.href !== lastUrl) {
      // Single-page shops change product without reloading.
      lastUrl = location.href;
      dismissed = false;
      shownFor = null;
      watchUntil = Date.now() + WATCH_FOR_MS;
      remove();
    }
    if (dismissed || !hasCandidateTable()) return;
    const request: SuggestRequest = { type: "aurora:suggest", tables: readTablesInPage() };
    let response: SuggestResponse;
    try {
      response = (await browser.runtime.sendMessage(request)) as SuggestResponse;
    } catch {
      return; // extension reloaded or not signed in
    }
    if (response.kind === "none") return;
    const key = `${location.href}|${response.kind === "suggestion" ? response.label : response.kind}`;
    if (key === shownFor) return;
    shownFor = key;
    if (response.kind === "suggestion") render(response);
    else if (response.kind === "missing-measurements") renderMissing(response);
    else renderNudge();
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void scan(), RESCAN_DELAY_MS);
  }

  function remove(): void {
    host?.remove();
    host = null;
  }

  function reason(response: Extract<SuggestResponse, { kind: "suggestion" }>): string {
    const names = (status: string) =>
      response.fits.filter((f) => f.status === status).map((f) => FIELD_INFO[f.field].label.toLowerCase());
    const fits = names("fits");
    const off = [...names("below"), ...names("above")];
    const list = (items: string[]) =>
      items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");
    if (response.quality === "poor") return "Closest size; your measurements are outside this chart.";
    if (off.length === 0) return `Fits your ${list(fits)}.`;
    return fits.length ? `Fits your ${list(fits)}; ${list(off)} slightly off.` : `Closest size for your ${list(off)}.`;
  }

  function render(response: Extract<SuggestResponse, { kind: "suggestion" }>): void {
    const alt = response.alternative
      ? `<p class="alt">On the edge: ${escape(response.alternative.label)} for a ${response.alternative.reason === "larger" ? "looser" : "closer"} fit.</p>`
      : "";
    show(`
      <p class="size">Suggested size <strong>${escape(response.label)}</strong></p>
      <p>${escape(reason(response))}</p>
      ${alt}
      <p class="muted">From this page's size chart and your “${escape(response.profileName)}” profile. Open Trialandfit for details.</p>`);
  }

  function renderNudge(): void {
    show(`
      <p>This size chart lists the garment's own measurements.</p>
      <p class="muted">Switch the size guide to body sizes (often a “Body size” tab) and Trialandfit will suggest a size.</p>`);
  }

  function renderMissing(response: Extract<SuggestResponse, { kind: "missing-measurements" }>): void {
    const names = response.needed.map((f) => FIELD_INFO[f].label.toLowerCase());
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
    show(`
      <p>Trialandfit needs your ${escape(list)} measurement to suggest a size here.</p>
      <p class="muted">Add it to your “${escape(response.profileName)}” profile on the Trialandfit website, then reload this page.</p>`);
  }

  function show(body: string): void {
    remove();
    host = document.createElement("aurora-size-card");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 260px;
          box-sizing: border-box; padding: 12px 14px; border-radius: 12px;
          font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
          background: #ffffff; color: #1b1523; border: 1px solid #d9ccfa;
          border-top: 4px solid #7b5bc7;
          box-shadow: 0 10px 28px rgba(59, 35, 120, .18);
        }
        .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .brand { font-weight: 600; font-size: 12px; letter-spacing: .02em; color: #7b5bc7; }
        .size { margin: 6px 0 2px; font-size: 15px; }
        .size strong { font-size: 22px; color: #7b5bc7; }
        p { margin: 0; }
        p + p { margin-top: 4px; }
        .muted { color: #625a70; font-size: 12px; margin-top: 6px; }
        button {
          all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 6px;
          display: grid; place-items: center; font-size: 16px; line-height: 1;
        }
        button:hover { background: #ece5fc; }
        button:focus-visible { outline: 2px solid #9478d8; outline-offset: 2px; }
      </style>
      <section class="card" role="region" aria-label="Trialandfit size suggestion" aria-live="polite">
        <div class="top">
          <span class="brand">Trialandfit</span>
          <button type="button" aria-label="Close size suggestion">×</button>
        </div>
        ${body}
      </section>`;
    root.querySelector("button")?.addEventListener("click", () => {
      dismissed = true;
      remove();
    });
    document.documentElement.append(host);
  }

  function escape(text: string): string {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  // Re-check when the page changes (size guide opened, colour/product switched), for a while.
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) watchUntil = Date.now() + WATCH_FOR_MS;
    if (Date.now() < watchUntil) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Size guides often open by sliding an existing panel into view (CSS only, no DOM change),
  // so also re-check after clicks and once animations and transitions finish.
  document.addEventListener(
    "click",
    () => {
      watchUntil = Math.max(watchUntil, Date.now() + WATCH_FOR_MS);
      schedule();
    },
    true,
  );
  for (const type of ["transitionend", "animationend"]) {
    document.addEventListener(type, () => Date.now() < watchUntil && schedule(), true);
  }
  void scan();
});
