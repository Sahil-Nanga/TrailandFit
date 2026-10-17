import { errorMessage, type MeasurementProfile } from "@aurora/api-client";
import {
  FIELD_INFO,
  FIELD_ORDER,
  formatForInput,
  type Units,
  unitLabel,
} from "@aurora/measurements";
import type { Session } from "@supabase/supabase-js";
import { type FormEvent, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { WEB_URL } from "@/lib/config";
import { DEFAULT_PREFS, loadPrefs, type Prefs, savePrefs } from "@/lib/prefs";
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
        <strong>Aurora</strong>
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

function Signedin() {
  const [profiles, setProfiles] = useState<MeasurementProfile[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loaded, result] = await Promise.all([
        loadPrefs(),
        api.GET("/v1/profiles", { params: { query: { limit: 100 } } }).catch(() => null),
      ]);
      if (cancelled) return;
      setPrefs(loaded);
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

  const profile = profiles.find((p) => p.id === prefs.profileId) ?? profiles[0];

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
              <select value={profile.id} onChange={(event) => update({ profileId: event.target.value })}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <UnitSwitch units={prefs.units} onChange={(units) => update({ units })} />
          <MeasurementList profile={profile} units={prefs.units} onCopy={copy} />
          <p className="muted small" aria-live="polite">
            {copied ? `Copied ${copied}` : " "}
          </p>
        </>
      )}

      <SavePage />

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

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

function SavePage() {
  const [tab, setTab] = useState<{ url: string; title: string } | null | undefined>(undefined);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    // activeTab lets us read the current tab's URL and title only because you opened the popup.
    void browser.tabs.query({ active: true, currentWindow: true }).then(([current]) => {
      const url = current?.url ?? "";
      setTab(/^https?:\/\//.test(url) ? { url, title: current?.title ?? "" } : null);
    });
  }, []);

  async function save() {
    if (!tab) return;
    setState({ kind: "saving" });
    try {
      const { error } = await api.POST("/v1/saved-items", {
        body: { url: tab.url, title: tab.title.slice(0, 300) || null },
      });
      setState(error ? { kind: "error", message: errorMessage(error, "Could not save this page.") } : { kind: "saved" });
    } catch {
      setState({ kind: "error", message: "Can't reach the server." });
    }
  }

  return (
    <section className="stack save" aria-label="Save this page">
      <button type="button" className="primary" disabled={!tab || state.kind === "saving" || state.kind === "saved"} onClick={() => void save()}>
        {state.kind === "saved" ? "Saved ✓" : state.kind === "saving" ? "Saving…" : "Save this page"}
      </button>
      <p className="muted small" aria-live="polite">
        {tab === null
          ? "Open a clothing page to save it for later."
          : state.kind === "error"
            ? state.message
            : state.kind === "saved"
              ? "Saved to your account for try-on later."
              : "Saves this page's link and title to your account."}
      </p>
    </section>
  );
}
