# Aurora API

FastAPI backend. See `/AGENT.md` (CLAUDE.md) for architecture and rules.

## Local setup

```bash
cp .env.example .env            # SUPABASE_URL defaults to local `supabase start`
uv sync
uv run python -m scripts.download_models   # MediaPipe pose model (~30 MB, checksum-verified)
docker compose up -d --wait db  # Postgres 17 on 127.0.0.1:5432
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

- Health: `GET /v1/health` (add `?db=true` to check the database)
- Profiles: `/v1/profiles`, saved clothing links: `/v1/saved-items`
- Photo estimate: `POST /v1/photos/estimate` (multipart; photos stay in memory, never stored)
- Docs: http://localhost:8000/docs (disabled in production)

## Checks

```bash
uv run ruff check . && uv run ruff format .
uv run mypy app tests
uv run pytest        # Postgres tests use testcontainers and need Docker running
```

## Auth

Tokens are Supabase access tokens. `get_current_user` (`app/core/security.py`) verifies
signature, expiry, audience and issuer against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
falling back to `SUPABASE_JWT_SECRET` only for legacy HS256 projects. Protect a route with
`user: CurrentUserDep`.
