import type { MeasurementProfile, Measurements } from "@aurora/api-client";
import { METRIC, type Units } from "@aurora/measurements";
import { Suspense, useState } from "react";

import { AccountPanel } from "./account/AccountPanel";
import { useAccount } from "./account/useAccount";

import { BodyModel, HAIR_COLORS, HairModel, type HairStyle, Stage, useFittedShape } from "@aurora/body3d";

import { BODY_FIT_URL } from "./config";
import { LookPanel } from "./likeness/LookPanel";
import { useLikeness } from "./likeness/useLikeness";
import { type Field, MeasurementPanel } from "./ui/MeasurementPanel";

const DEFAULTS: Measurements = {
  height_cm: 175,
  weight_kg: 70,
  chest_cm: 96,
  waist_cm: 82,
  hips_cm: 98,
  shoulder_width_cm: 44,
  inseam_cm: 79,
};

const DEFAULT_SKIN = "#c99a7a";
const SKIN_TONES = [
  { name: "Light", color: "#e8c4ad" },
  { name: "Medium", color: DEFAULT_SKIN },
  { name: "Tan", color: "#a87756" },
  { name: "Deep", color: "#6e4a35" },
];

export function App() {
  const [measurements, setMeasurements] = useState<Measurements>(DEFAULTS);
  const [sex, setSex] = useState<"female" | "male">("female");
  const bodyType = sex === "male" ? 1 : 0; // the body's base shape: 0 female, 1 male
  const [units, setUnits] = useState<Units>(METRIC);
  const [skin, setSkin] = useState(DEFAULT_SKIN);
  const [hair, setHair] = useState<HairStyle | null>("short");
  const [hairColor, setHairColor] = useState(HAIR_COLORS[1]?.color ?? "#5c4232");
  // Fields the user actually has (from their profile or edited here). Others show a typical
  // value for the 3D body but are never saved as if they had been measured.
  const [provided, setProvided] = useState<ReadonlySet<Field>>(new Set());

  const { shape, fitted, status } = useFittedShape(BODY_FIT_URL, measurements, bodyType);
  // The signed-in profile's numbers fill the form (fields the profile lacks keep their value).
  const applyProfile = (profile: MeasurementProfile) => {
    const fromProfile = Object.fromEntries(
      Object.entries(profile.measurements).filter(([key, value]) => value != null && key in DEFAULTS),
    );
    setMeasurements((m) => ({ ...m, ...fromProfile }));
    setProvided(new Set(Object.keys(fromProfile) as Field[]));
  };
  const account = useAccount(applyProfile);
  const look = useLikeness(account.session ? (account.profile?.id ?? null) : null);
  const update = (field: Field, metric: number) => {
    account.resetSave();
    setMeasurements((m) => ({ ...m, [field]: Math.round(metric * 10) / 10 }));
    setProvided((p) => new Set([...p, field]));
  };

  return (
    <div className="layout">
      <aside className="panel" aria-label="Body measurements">
        <header>
          <h1>
            <span className="brand">Trialandfit</span> 3D body
          </h1>
          <p className="muted">Prototype · measurements shape the body</p>
        </header>

        <div className="toggles">
          <div className="segmented" role="group" aria-label="Length unit">
            {(["cm", "in"] as const).map((length) => (
              <button key={length} aria-pressed={units.length === length} onClick={() => setUnits({ ...units, length })}>
                {length}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Weight unit">
            {(["kg", "lb"] as const).map((weight) => (
              <button key={weight} aria-pressed={units.weight === weight} onClick={() => setUnits({ ...units, weight })}>
                {weight}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label" id="body-label">Body</span>
          <div className="segmented" role="group" aria-labelledby="body-label">
            {(["female", "male"] as const).map((option) => (
              <button key={option} aria-pressed={sex === option} onClick={() => setSex(option)}>
                {option === "female" ? "Female" : "Male"}
              </button>
            ))}
          </div>
        </div>

        <p className={`status ${status}`} role="status">
          {status === "fitting" && "Fitting the body…"}
          {status === "fitted" &&
            (fitted?.withinTolerance
              ? `Fitted: every measurement within ${fitted.toleranceCm} cm`
              : "Fitted as closely as this base body allows")}
          {status === "offline" && "Body-fit service not running: showing a quick estimate"}
        </p>

        <MeasurementPanel
          measurements={measurements}
          units={units}
          shape={shape}
          fitted={fitted}
          provided={account.profile ? provided : null}
          onChange={update}
        />

        <AccountPanel
          available={account.available}
          signedIn={account.session !== null}
          profile={account.profile}
          save={account.save}
          onSignIn={account.signIn}
          onSignOut={() => void account.signOut()}
          onLoad={() => account.profile && applyProfile(account.profile)}
          onSave={() =>
            void account.saveMeasurements(
              Object.fromEntries([...provided].map((f) => [f, measurements[f]])) as Partial<Measurements>,
            )
          }
        />

        <LookPanel
          likeness={account.profile ? look.state : null}
          onUsePhoto={() => void look.apply(shape.weights, bodyType)}
          onRemovePhoto={look.clear}
          hair={hair}
          hairColor={hairColor}
          onHair={setHair}
          onHairColor={setHairColor}
        />

        <fieldset className="skin" disabled={look.likeness !== null}>
          <legend>Skin tone{look.likeness && <span className="typical">from your photo</span>}</legend>
          {SKIN_TONES.map((tone) => (
            <button
              key={tone.name}
              className="swatch"
              style={{ background: tone.color }}
              aria-label={tone.name}
              aria-pressed={skin === tone.color}
              onClick={() => setSkin(tone.color)}
            />
          ))}
        </fieldset>
      </aside>

      <main className="viewer" aria-label="3D body preview">
        <Suspense fallback={<p className="loading">Loading body…</p>}>
          <Stage focusHeight={measurements.height_cm / 100}>
            <BodyModel
              shape={shape}
              skinColor={skin}
              texture={look.likeness?.texture}
              eyeColor={look.likeness?.eyeColor}
            />
            {hair && (
              <Suspense fallback={null}>
                <HairModel style={hair} color={hairColor} shape={shape} />
              </Suspense>
            )}
          </Stage>
        </Suspense>
      </main>
    </div>
  );
}
