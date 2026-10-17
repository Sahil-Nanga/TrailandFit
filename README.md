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

## Try-on (for the 3D renderer)

The website's **Try on** page (`/try-on`) lets the user pick one top and one bottom from their
wardrobe for the active profile. The 3D view is an empty placeholder:
`apps/web/components/try-on/avatar-viewer.tsx`. Replace its body with the renderer and keep
its props:

- `measurements`: the active profile, in cm/kg (`height_cm` always set, others may be null)
- `outfit.top` / `outfit.bottom`: `{ id, category, title, url, imageUrl }` or null

## Privacy notes

- Photos are processed in memory and discarded; they are never written to disk, stored or
  logged. Uploads are capped at 10 MB per photo and rate-limited per user.
- Photo estimation runs on our own server (MediaPipe); photos are not sent to third parties.
- The extension asks only for `activeTab` and `storage`.
