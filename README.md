# Trialandfit

Get your body measurements from a photo or by entering them, save them, and take them to
any clothing site with the browser extension. See `CLAUDE.md` for architecture and rules.

| Part | Where | Runs on |
|---|---|---|
| API (FastAPI) | `apps/api` | http://localhost:8000 |
| Website (Next.js) | `apps/web` | http://localhost:3000 |
| Browser extension (WXT) | `apps/extension` | Chrome, unpacked |
| Auth (Supabase, local) | `supabase/` | http://127.0.0.1:54321, Studio on :54323 |
| App database (Postgres) | `apps/api/docker-compose.yml` | localhost:5432 |

Supabase is used **only for auth**. Profiles and saved items live in the API's own Postgres.

## First-time setup

Needs Docker, [uv](https://docs.astral.sh/uv/), pnpm and the Supabase CLI
(`brew install supabase/tap/supabase`).

```bash
pnpm install

# Auth (from the repo root). Generates a local ES256 signing key the first time.
echo "[]" > supabase/signing_keys.json
supabase gen signing-key --algorithm ES256 --append
supabase start

# API
cd apps/api
cp .env.example .env
uv sync
uv run python -m scripts.download_models   # MediaPipe pose model, checksum-verified
docker compose up -d --wait db
uv run alembic upgrade head
cd ../..

# Website and extension: copy the example env files, then fill the publishable key from
# `supabase status` (it is a public key, not a secret).
cp apps/web/.env.example apps/web/.env.local
cp apps/extension/.env.example apps/extension/.env.local
```

## Daily use

```bash
supabase start                                   # if not running
cd apps/api && docker compose up -d --wait db    # if not running
uv run --directory apps/api uvicorn app.main:app --reload
pnpm dev:web
pnpm --filter extension dev                      # opens Chrome with the extension loaded
```

Emails sent by local auth (if you turn on confirmations) appear in Mailpit at
http://127.0.0.1:54324.

## Checks

```bash
pnpm lint && pnpm typecheck
cd apps/api && uv run ruff check . && uv run mypy app tests && uv run pytest
```

After changing a Pydantic schema, regenerate the TypeScript client: `pnpm gen:api`.

## Moving auth to Supabase Cloud

No code changes. Create a project, then:

1. `apps/api/.env`: `SUPABASE_URL=https://<project-ref>.supabase.co`. The API verifies
   tokens against that project's JWKS (`/auth/v1/.well-known/jwks.json`). Projects still on
   the legacy shared secret also need `SUPABASE_JWT_SECRET`.
2. `apps/web/.env.local` and `apps/extension/.env.local`: the project URL and publishable
   key.
3. In the Supabase dashboard: set the Site URL to the website's URL, add it to the redirect
   allow list, and point the "Confirm signup" email template at
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
4. Production API: list the website and the published extension origin
   (`chrome-extension://<id>`) in `CORS_ORIGINS` and leave `CORS_ORIGIN_REGEX` unset.

## Try-on

The website's **Try on** page (`/try-on`) lets the user pick one top and one bottom from their
wardrobe for the active profile, next to a 3D preview of their body
(`apps/web/components/try-on/avatar-viewer.tsx`, built on `packages/body3d`). The preview is
shaped by the body-fit service from the profile's measurements (a quick estimate if the service
isn't running), shows the face from the kept front photo when the user opted in to keeping
photos, and has hair presets. Set `NEXT_PUBLIC_BODY_FIT_URL` (default
`http://127.0.0.1:8001`) and run the body-fit service.

The picked clothes are drawn on the body, in the size you pick. **View on me** in the extension
saves the shop page with its sizes (which are sold out) and size chart, and opens
`/try-on?item=<id>` wearing it.

- Shape: MakeHuman CC0 garment models (T-shirt, long sleeves, jeans, shorts, skirt) bound to
  the body like the hair, so they follow its shape; the style is guessed from the title. Skin
  under them is hidden so it can't poke through (`packages/body3d/src/garments.ts`,
  `GarmentModel.tsx`).
- Size: the picker shows the shop's sizes, preselects the one the size chart suggests, and the
  garment is loosened or tightened by the room that size leaves at the chest, waist, hips and
  thighs (`packages/measurements/src/store-sizes.ts`). Without a size chart every size looks
  the same.
- Look: the body-fit service fetches the product picture (`POST /garment-image`; public
  addresses only), removes a plain backdrop, crops to the garment when a model is wearing it
  (MediaPipe pose), and the picture goes on the front with its main colour on the back.
- Limits: no cloth simulation, one model per style, and model photos map less well than flat
  product shots.

Rebuilding: after `body.glb` changes, re-run `packages/body3d/scripts/garment_landmarks.py`
and `MAKEHUMAN_DATA=... MAKEHUMAN_ASSETS=... pnpm --filter @aurora/body3d build:clothes`
(the assets are the CC0 pack listed in `packages/body3d/assets/ASSETS.md`).

The viewer's props:

- `measurements`: the active profile, in cm/kg (`height_cm` always set, others may be null)
- `outfit.top` / `outfit.bottom`: `{ id, category, title, url, imageUrl }` or null

## 3D body prototype (`apps/modeler`)

Measurements in, 3D body out, in the browser. Phase 1: a MakeHuman (CC0) base body with
morph targets, shaped live from the measurement form.

```bash
pnpm --filter modeler dev          # http://localhost:5173
pnpm --filter modeler test         # measurement -> morph mapping tests
uv run --directory services/body-fit python -m scripts.download_models   # face + pose models (once)
uv run --directory services/body-fit uvicorn body_fit.main:app --port 8001   # fitting, face, garment pictures
uv run --directory services/body-fit pytest
```

Phase 2: the body-fit service (`services/body-fit`, FastAPI + NumPy/SciPy) measures the actual
mesh (convex-hull "tape measure" slices) and fits the morphs with bounded least squares until
the body matches the measurements within 1.5 cm, or reports the closest it can reach. Without
the service the modeler falls back to a quick linear estimate. Signed in, the modeler loads the
active Trialandfit profile and can save adjusted numbers back to it (only fields the user has).

Phase 3: photo likeness. "Use my photo" takes the active profile's kept front photo (the user
must have ticked "Keep my photos" on the website), sends it to body-fit `POST /likeness`, which
finds the face (MediaPipe Face Landmarker), lines the body's eyes and lips up with the photo and
bakes the face into the body texture, blended into a skin colour taken from the cheeks and
forehead. The texture comes back in the response and is kept only in the page's memory. Clear
errors for no face, several faces, a small or low-resolution face and a turned head. Hair: four
MakeHuman presets (short, bob, long, ponytail) that follow the body's morphs, with a colour tint.
Limits: it's a flat photo wrapped on the head (lighting from the photo is baked in, and the sides
and back of the head are plain skin), the eyes are simple spheres, and the face shape still
comes from the base body, not the photo.

Rebuilding the body model (only needed when changing morphs): sparse-clone MakeHuman's
`makehuman/data` (3dobjs, targets/macrodetails, targets/measure) and run
`MAKEHUMAN_DATA=/path/to/makehuman/data pnpm --filter @aurora/body3d build:body`. To rebuild the hair
too, also set `MAKEHUMAN_ASSETS` to the extracted MakeHuman system assets (the folder that
contains `hair/`).
The shared 3D code and assets live in `packages/body3d` (both the modeler and the website use
it). Asset sources and licences: `packages/body3d/assets/ASSETS.md`.

## Privacy notes

- Photos are processed in memory and discarded; they are never written to disk, stored or
  logged. Uploads are capped at 10 MB per photo and rate-limited per user.
- Photo estimation runs on our own server (MediaPipe); photos are not sent to third parties.
- The extension asks only for `activeTab` and `storage`.
