import { errorMessage, type MeasurementProfile } from "@aurora/api-client";
import {
  chartFromTables,
  FIELD_INFO,
  FIELD_ORDER,
  formatForInput,
  type FieldFit,
  type SuggestionResult,
  suggestFromTables,
  type Units,
  unitLabel,
} from "@aurora/measurements";
import type { Session } from "@supabase/supabase-js";
import { type FormEvent, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { DEFAULT_PREFS, loadPrefs, type Prefs, savePrefs } from "@/lib/prefs";
import { originPattern } from "@/lib/messages";
import { readSizeOptions } from "@/lib/read-sizes";
import { readProductImage, readTables } from "@/lib/read-tables";
import { supabase } from "@/lib/supabase";

function openWebsite(path: string) {
  void browser.tabs.create({ url: `${WEB_URL}${path}` });
  window.close();
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <main>
      <header>
        <strong>Trialandfit</strong>
        {session && (
          <button type="button" className="link" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        )}
      </header>
      {session === undefined ? (
        <p className="muted" role="status">Loading…</p>
      ) : session === null ? (
        <SignIn />
      ) : (
        <Signedin />
      )}
    </main>
  );
}

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="stack">
      <p className="muted">Sign in to see your measurements.</p>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <button type="button" className="link" onClick={() => openWebsite("/sign-up")}>
        New here? Create an account
      </button>
    </form>
  );
}

interface CurrentTab {
  id: number;
  url: string;
  title: string;
}

/** The tab the popup was opened on, if it is a normal web page. */
function useCurrentTab(): CurrentTab | null | undefined {
  const [tab, setTab] = useState<CurrentTab | null | undefined>(undefined);
  useEffect(() => {
    // activeTab lets us see this tab's URL and title only because you opened the popup.
    void browser.tabs.query({ active: true, currentWindow: true }).then(([current]) => {
      const url = current?.url ?? "";
      setTab(
        current?.id !== undefined && /^https?:\/\//.test(url)
          ? { id: current.id, url, title: current.title ?? "" }
          : null,
      );
    });
  }, []);
  return tab;
}

function Signedin() {
  const tab = useCurrentTab();
  const [profiles, setProfiles] = useState<MeasurementProfile[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loaded, result, settings] = await Promise.all([
        loadPrefs(),
        api.GET("/v1/profiles", { params: { query: { limit: 100 } } }).catch(() => null),
        api.GET("/v1/account/settings").catch(() => null),
      ]);
      if (cancelled) return;
      setPrefs(loaded);
      setActiveId(settings?.data?.active_profile_id ?? null);
      if (!result?.data) {
        setError(result ? errorMessage(result.error, "Could not load your measurements.") : "Can't reach the server.");
        setProfiles([]);
        return;
      }
      setProfiles(result.data.items);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The active profile lives on the account, so the website and extension always agree. */
  function chooseProfile(id: string) {
    setActiveId(id);
    void api.PATCH("/v1/account/settings", { body: { active_profile_id: id } });
  }

  function update(next: Partial<Prefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    void savePrefs(merged);
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
  }

  if (profiles === null) return <p className="muted" role="status">Loading…</p>;

  const profile = profiles.find((p) => p.id === activeId) ?? profiles[0];

  return (
    <div className="stack">
      {error && <p role="alert" className="error">{error}</p>}

      {!profile && !error && (
        <div className="stack">
          <p className="muted">You have no saved measurements yet.</p>
          <button type="button" className="primary" onClick={() => openWebsite("/")}>
            Add measurements
          </button>
        </div>
      )}

      {profile && (
        <>
          {profiles.length > 1 && (
            <label>
              Profile
              <select value={profile.id} onChange={(event) => chooseProfile(event.target.value)}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <UnitSwitch units={prefs.units} onChange={(units) => update({ units })} />
          {tab && <SizeSuggestion tabId={tab.id} profile={profile} units={prefs.units} />}
          {tab && <AutoSuggestToggle tab={tab} />}
          <MeasurementList profile={profile} units={prefs.units} onCopy={copy} />
          <p className="muted small" aria-live="polite">
            {copied ? `Copied ${copied}` : " "}
          </p>
        </>
      )}

      <SavePage tab={tab} />

      <button type="button" className="link" onClick={() => openWebsite("/profiles")}>
        Edit measurements on the website
      </button>
    </div>
  );
}

function UnitSwitch({ units, onChange }: { units: Units; onChange: (units: Units) => void }) {
  return (
    <div className="row">
      <div className="segmented" role="group" aria-label="Length unit">
        {(["cm", "in"] as const).map((length) => (
          <button key={length} type="button" aria-pressed={units.length === length} onClick={() => onChange({ ...units, length })}>
            {length}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Weight unit">
        {(["kg", "lb"] as const).map((weight) => (
          <button key={weight} type="button" aria-pressed={units.weight === weight} onClick={() => onChange({ ...units, weight })}>
            {weight}
          </button>
        ))}
      </div>
    </div>
  );
}

function MeasurementList({
  profile,
  units,
  onCopy,
}: {
  profile: MeasurementProfile;
  units: Units;
  onCopy: (text: string, label: string) => Promise<void>;
}) {
  const rows = FIELD_ORDER.flatMap((field) => {
    const value = formatForInput(field, profile.measurements[field], units);
    return value ? [{ field, label: FIELD_INFO[field].label, text: `${value} ${unitLabel(field, units)}` }] : [];
  });
  const all = rows.map((row) => `${row.label}: ${row.text}`).join("\n");

  return (
    <div className="stack">
      <ul className="measurements">
        {rows.map((row) => (
          <li key={row.field}>
            <span>{row.label}</span>
            <span className="value">{row.text}</span>
            <button type="button" className="copy" aria-label={`Copy ${row.label.toLowerCase()}`} onClick={() => void onCopy(row.text, row.label.toLowerCase())}>
              Copy
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void onCopy(all, "all measurements")}>
        Copy all
      </button>
    </div>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; then: "stay" | "view" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function SavePage({ tab }: { tab: CurrentTab | null | undefined }) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  /** Save this page (saving it again returns the existing item); "view" opens it on the 3D body. */
  async function save(then: "stay" | "view") {
    if (!tab) return;
    setState({ kind: "saving", then });
    try {
      const [image, sizes, tables] = await Promise.all([
        readProductImage(tab.id),
        readSizeOptions(tab.id),
        readTables(tab.id),
      ]);
      const chart = chartFromTables(tables);
      const { data, error } = await api.POST("/v1/saved-items", {
        body: {
          url: tab.url,
          // "Product name - Category | Shop" -> "Product name - Category"
          title: tab.title.split(" | ")[0]?.trim().slice(0, 300) || null,
          image_url: image,
          // The shop's sizes and size chart, for the size picker on the try-on page.
          sizes: sizes.length > 0 ? sizes.map((s) => ({ ...s, label: s.label.slice(0, 40) })) : null,
          size_chart: chart && {
            ...chart,
            sizes: chart.sizes.slice(0, 40).map((s) => ({ ...s, label: s.label.slice(0, 40) })),
          },
        },
      });
      if (!data) {
        setState({ kind: "error", message: errorMessage(error, "Could not save this page.") });
        return;
      }
      if (then === "view") {
        openWebsite(`/try-on?item=${encodeURIComponent(data.id)}`);
        return;
      }
      setState({ kind: "saved" });
    } catch {
      setState({ kind: "error", message: "Can't reach the server." });
    }
  }

  const saving = state.kind === "saving";
  return (
    <section className="stack save" aria-label="Save this page">
      <div className="row">
        <button type="button" className="primary" disabled={!tab || saving} onClick={() => void save("view")}>
          {saving && state.then === "view" ? "Opening…" : "View on me"}
        </button>
        <button type="button" disabled={!tab || saving || state.kind === "saved"} onClick={() => void save("stay")}>
          {state.kind === "saved" ? "Saved ✓" : saving && state.then === "stay" ? "Saving…" : "Save this page"}
        </button>
      </div>
      <p className="muted small" aria-live="polite">
        {tab === null
          ? "Open a clothing page to save it for later."
          : state.kind === "error"
            ? state.message
            : state.kind === "saved"
              ? "Saved to your wardrobe on the Trialandfit website."
              : "View on me saves this item with its sizes and shows it on your 3D body on the website."}
      </p>
    </section>
  );
}

function formatValue(field: FieldFit["field"], value: number, units: Units): string {
  return `${formatForInput(field, value, units)} ${unitLabel(field, units)}`;
}

function FitLine({ fit, size, units }: { fit: FieldFit; size: string; units: Units }) {
  const label = FIELD_INFO[fit.field].label;
  const range = `${formatForInput(fit.field, fit.range.min, units)}–${formatValue(fit.field, fit.range.max, units)}`;
  const yours = formatValue(fit.field, fit.value, units);
  if (fit.status === "fits") return <li>✓ {label} {yours} fits {size} ({range})</li>;
  return (
    <li>
      ! {label} {yours} is {fit.status === "below" ? "below" : "above"} {size} ({range})
    </li>
  );
}

function SizeSuggestion({
  tabId,
  profile,
  units,
}: {
  tabId: number;
  profile: MeasurementProfile;
  units: Units;
}) {
  const [result, setResult] = useState<SuggestionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Read the size chart and match it here in the extension; measurements never leave it.
    void readTables(tabId).then((tables) => {
      if (!cancelled) setResult(suggestFromTables(tables, profile.measurements));
    });
    return () => {
      cancelled = true;
    };
  }, [tabId, profile]);

  if (result === null) {
    return <p className="muted small" role="status">Looking for a size chart…</p>;
  }
  if (result.kind === "no-chart") {
    return (
      <p className="muted small">
        No size chart on this page. Open the shop&apos;s size guide, then open Trialandfit again for a size
        suggestion.
      </p>
    );
  }
  if (result.kind === "garment-only") {
    return (
      <p className="muted small">
        This size chart lists the garment&apos;s own measurements. Switch the size guide to body
        sizes (often a &ldquo;Body size&rdquo; tab), then open Trialandfit again.
      </p>
    );
  }
  if (result.kind === "missing-measurements") {
    const names = result.needed.map((f) => FIELD_INFO[f].label.toLowerCase()).join(", ");
    return (
      <p className="muted small">
        This size chart uses {names}. Add {result.needed.length > 1 ? "them" : "it"} to your
        profile for a size suggestion.
      </p>
    );
  }

  const { suggestion } = result;
  return (
    <section className="suggestion" aria-label="Size suggestion">
      <p className="suggestion-size">
        Try size <strong>{suggestion.label}</strong>
      </p>
      <ul className="fits">
        {suggestion.fits.map((fit) => (
          <FitLine key={fit.field} fit={fit} size={suggestion.label} units={units} />
        ))}
      </ul>
      {suggestion.quality === "poor" && (
        <p className="small">Your measurements are outside this chart; {suggestion.label} is the closest size.</p>
      )}
      {suggestion.alternative && (
        <p className="small">
          You&apos;re on the edge: {suggestion.alternative.label} if you prefer a{" "}
          {suggestion.alternative.reason === "larger" ? "looser" : "closer"} fit.
        </p>
      )}
      <p className="muted small">From this page&apos;s size chart and your “{profile.name}” profile.</p>
    </section>
  );
}

/** Per-shop opt-in for the automatic on-page suggestion card. */
function AutoSuggestToggle({ tab }: { tab: CurrentTab }) {
  const pattern = originPattern(tab.url);
  const host = new URL(tab.url).hostname.replace(/^www\./, "");
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!pattern) return;
    void browser.permissions.contains({ origins: [pattern] }).then(setEnabled);
  }, [pattern]);

  if (!pattern || enabled === null) return null;

  function turnOn() {
    if (!pattern) return;
    // Must be called straight from the click: browsers only show permission prompts then.
    void browser.permissions.request({ origins: [pattern] }).then(async (granted) => {
      setEnabled(granted);
      if (granted) {
        await browser.scripting
          .executeScript({ target: { tabId: tab.id }, files: ["/size-card.js"] })
          .catch(() => undefined);
      }
    });
  }

  function turnOff() {
    if (!pattern) return;
    void browser.permissions.remove({ origins: [pattern] }).then((removed) => setEnabled(!removed));
  }

  return (
    <div className="auto">
      {enabled ? (
        <>
          <p className="small">Size suggestions appear automatically on {host}.</p>
          <button type="button" className="link" onClick={turnOff}>
            Turn off for {host}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={turnOn}>
            Always suggest sizes on {host}
          </button>
          <p className="muted small">
            Trialandfit will read only size charts on {host}, and show a small suggestion on its pages.
          </p>
        </>
      )}
    </div>
  );
}
