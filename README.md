# Anagami AI Core

Internal multi-agent platform scaffold with Node.js + Express + PostgreSQL.

## Features
- JWT auth with email/password (token in `sessionStorage` on client).
- Roles: `admin`, `user`.
- Agents tabs: Email Replies, Offers, Contracts, Support, Marketing, Recruiting, Admin.
- Task workflow: create -> generate draft (OpenAI + active prompt version) -> edit -> approve -> history/search.
- Normalized PostgreSQL schema, **no json/jsonb columns**.
- Templates and generated files in PostgreSQL `BYTEA`.
- Export endpoints for offers/contracts with DOCX/PDF pipeline (PDF conversion via LibreOffice + `/tmp` ephemeral files).
- Admin endpoints for users, prompts, knowledge, templates, pricing skeleton.


## Default admin login
- Email: `ogi.stoev80@gmail.com`
- Password: `12345678`
- On first login (and after admin password reset), the UI forces password change from Profile section before any agent/admin actions.

## Setup
1. Create DB and copy env:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run migrations:
   ```bash
   npm run migrate
   ```
4. Start server:
   ```bash
   npm start
   ```
5. Open `http://localhost:8789`.

## Placeholder mapping example (DOCX)
Use placeholders from DB fields such as:
- Offer: `{{client_name}}`, `{{client_company}}`, `{{subtotal}}`, `{{total}}`.
- Repeating rows (offer items): row template with `{{line_no}}`, `{{description}}`, `{{qty}}`, `{{unit_price}}`, `{{line_total}}`.
- Contract: `{{client_name}}`, `{{contract_type}}`, `{{terms}}`.

## API highlights
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/agents`
- `POST /api/tasks`
- `POST /api/tasks/:id/generate`
- `PATCH /api/tasks/:id/sections`
- `POST /api/tasks/:id/approve`
- `POST /api/offers/:id/export?format=docx|pdf`
- `POST /api/contracts/:id/export?format=docx|pdf`
- `GET /api/files/:id/download`

## Notes
- If pricing catalogs are empty, offers keep pricing section as `TBD / requires admin pricing setup`.
- Non-admin users are blocked from admin/pricing endpoints.
- Offers/contracts tabs are scaffold-ready; admin can configure templates/pricing later.
