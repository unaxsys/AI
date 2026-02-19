# Anagami AI Core

Node 18+ internal/public generator platform using **Express + SQLite + Vanilla JS**.

## Features

- Staff authentication with JWT (stored in `sessionStorage` client-side).
- Roles: `admin`, `manager`, `agent`, `viewer`.
- Mandatory task language selection (`bg` default, `en` supported).
- Public no-login generator page: `/offer.html`.
- Shared generation output format (strict six keys):
  - `analysis`
  - `service`
  - `pricing`
  - `proposalDraft`
  - `emailDraft`
  - `upsell`
- Prompt / Knowledge / Templates / Pricing CRUD with role-protected endpoints.
- Optional Turnstile verification on public endpoint.
- Public guardrails:
  - 10 req/IP/hour on `/api/public/generate`
  - max input 4000 chars
  - CORS allow-list: `anagami.bg`, `www.anagami.bg`
  - no full lead-text storage unless `STORE_PUBLIC_REQUESTS=true`
- `/api/health` and `/api/usage/local` monitoring endpoints.

## Environment

Create `.env`:

```bash
OPENAI_API_KEY=your_openai_key
JWT_SECRET=replace_with_long_secret
ADMIN_EMAIL=admin@anagami.bg
ADMIN_PASSWORD=change_me_now
TURNSTILE_SECRET=
STORE_PUBLIC_REQUESTS=false
PORT=8789
```

`OPENAI_API_KEY` and `JWT_SECRET` are required.

## Run commands

```bash
npm install
npm run migrate
npm start
```

Open:

- Staff app: `http://localhost:8789/`
- Public generator: `http://localhost:8789/offer.html`

## API highlights

- Auth:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
- Staff tasks:
  - `POST /api/tasks`
  - `POST /api/tasks/:id/generate`
  - `PATCH /api/tasks/:id/final`
  - `POST /api/tasks/:id/approve`
  - `GET /api/tasks`, `GET /api/tasks/:id`
- Public:
  - `POST /api/public/generate`
- Admin:
  - `GET/POST /api/admin/users`
  - `PATCH /api/admin/users/:id/status`
  - `POST /api/admin/users/:id/reset-password`
  - CRUD: `/api/admin/prompts`, `/api/admin/knowledge`, `/api/admin/templates`, `/api/admin/pricing`
- Monitoring:
  - `GET /api/health`
  - `GET /api/usage/local`

## Security notes

- Never auto-send emails (draft-only workflow).
- API key is never exposed to frontend.
- All secured endpoints require JWT and role checks.
