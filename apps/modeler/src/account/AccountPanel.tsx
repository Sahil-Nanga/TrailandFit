import type { MeasurementProfile } from "@aurora/api-client";
import { type FormEvent, useState } from "react";

import type { SaveState } from "./useAccount";

interface Props {
  available: boolean;
  signedIn: boolean;
  profile: MeasurementProfile | null;
  save: SaveState;
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignOut: () => void;
  onLoad: () => void;
  onSave: () => void;
}

export function AccountPanel({ available, signedIn, profile, save, onSignIn, onSignOut, onLoad, onSave }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!available) return null;

  if (!signedIn) {
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setBusy(true);
      setError(await onSignIn(String(form.get("email") ?? ""), String(form.get("password") ?? "")));
      setBusy(false);
    }
    return (
      <form className="account" onSubmit={(event) => void submit(event)}>
        <p className="muted">Sign in to load and save your Trialandfit measurements.</p>
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
      </form>
    );
  }

  return (
    <div className="account">
      {profile ? (
        <>
          <p className="muted">
            Profile: <strong>{profile.name}</strong>
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={onSave} disabled={save.kind === "saving"}>
              {save.kind === "saving" ? "Saving…" : "Save to profile"}
            </button>
            <button type="button" onClick={onLoad}>
              Reload from profile
            </button>
          </div>
          <p className="muted small" role="status">
            {save.kind === "saved" && "Saved. Your profile and the size suggestions now use these numbers."}
            {save.kind === "error" && <span className="error">{save.message}</span>}
          </p>
        </>
      ) : (
        <p className="muted">No profile yet. Create one on the Trialandfit website first.</p>
      )}
      <button type="button" className="link" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
