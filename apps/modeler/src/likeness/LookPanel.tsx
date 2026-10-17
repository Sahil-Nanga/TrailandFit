import { HAIR_COLORS, HAIR_STYLES, type HairStyle } from "@aurora/body3d";

import type { LikenessState } from "./useLikeness";

const WEB_URL = import.meta.env.VITE_WEB_URL ?? "http://localhost:3000";

interface Props {
  /** Null when signed out or without a profile: the photo option is hidden. */
  likeness: LikenessState | null;
  onUsePhoto: () => void;
  onRemovePhoto: () => void;
  hair: HairStyle | null;
  hairColor: string;
  onHair: (style: HairStyle | null) => void;
  onHairColor: (color: string) => void;
}

const label = (style: HairStyle) => style[0]?.toUpperCase() + style.slice(1);

export function LookPanel({ likeness, onUsePhoto, onRemovePhoto, hair, hairColor, onHair, onHairColor }: Props) {
  return (
    <section className="look" aria-label="Face and hair">
      {likeness && (
        <div className="look-photo">
          <h2>Face from your photo</h2>
          {likeness.kind === "ready" ? (
            <div className="row">
              <span className="muted">Using your saved front photo.</span>
              <button type="button" onClick={onRemovePhoto}>
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className="primary" onClick={onUsePhoto} disabled={likeness.kind === "working"}>
              {likeness.kind === "working" ? "Matching your face…" : "Use my photo"}
            </button>
          )}
          <p className="muted small" role="status">
            {likeness.kind === "no-photo" && (
              <>
                This profile has no saved photo. On the website,{" "}
                <a href={`${WEB_URL}/measure/photo`} target="_blank" rel="noreferrer">
                  measure from a photo
                </a>{" "}
                and tick “Keep my photos for my 3D try-on preview”.
              </>
            )}
            {likeness.kind === "error" && <span className="error">{likeness.message}</span>}
            {(likeness.kind === "idle" || likeness.kind === "working" || likeness.kind === "ready") &&
              "Your photo is processed in memory to make the face and isn't stored again. It's a flat photo wrapped on the head, so it looks best from the front."}
          </p>
        </div>
      )}

      <fieldset className="hair">
        <legend>Hair</legend>
        <div className="segmented" role="group" aria-label="Hair style">
          <button type="button" aria-pressed={hair === null} onClick={() => onHair(null)}>
            None
          </button>
          {HAIR_STYLES.map((style) => (
            <button key={style} type="button" aria-pressed={hair === style} onClick={() => onHair(style)}>
              {label(style)}
            </button>
          ))}
        </div>
        <div className="swatches" role="group" aria-label="Hair colour">
          {HAIR_COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              className="swatch"
              style={{ background: c.color }}
              aria-label={c.name}
              aria-pressed={hairColor === c.color}
              disabled={hair === null}
              onClick={() => onHairColor(c.color)}
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}
