# Anagami AI Core

Node 18+ internal/public generator platform using **Express + PostgreSQL + Vanilla JS**.

## Features

- Staff authentication with JWT (stored in `sessionStorage` client-side).
- Roles: `admin`, `user`.
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
  - CORS allow-list: `https://anagami.bg`, `https://www.anagami.bg`
  - no full lead-text storage unless `STORE_PUBLIC_REQUESTS=true`
- `/api/health` and `/api/usage/local` monitoring endpoints.

## Environment

Copy `.env.example` to `.env` and fill values.

Required:
- `OPENAI_API_KEY`
- `JWT_SECRET`
- database config via either `DATABASE_URL` or `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS`

## Run commands

```bash
npm install
npm run migrate
npm start
```

Open:
- Staff app: `http://localhost:8789/`
- Public generator: `http://localhost:8789/offer.html`

## Deploy on /opt/ai (pm2)

```bash
cd /opt/ai
npm install
npm run migrate
pm2 restart anagami-ai-core --update-env
```

If the app is not registered in pm2 yet:

```bash
cd /opt/ai
pm2 start server.js --name anagami-ai-core --update-env
```

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
