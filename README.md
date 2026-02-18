# Public AI Sales Proposal Agent

Публичен (без login) AI агент, вграден в уеб страница, който генерира ориентировъчно търговско предложение на база клиентско запитване.

## Стек
- Backend: Node.js + Express
- Frontend: Vanilla JS + HTML + CSS
- Storage: SQLite (само технически логове, до последните 100 заявки)
- Rate limiting: express-rate-limit

## Изисквания
- Node.js 18+
- `OPENAI_API_KEY`
- `SITE_API_KEY`

## Инсталация и пускане
1. Инсталирайте зависимостите:
   ```bash
   npm install
   ```
2. Създайте `.env` файл по шаблон от `.env.example`.
3. Стартирайте сървъра:
   ```bash
   OPENAI_API_KEY=... SITE_API_KEY=... PORT=8787 npm start
   ```
4. Отворете:
   - `http://localhost:8787`

## API
### `POST /api/generate`
Headers:
- `Content-Type: application/json`
- `x-site-api-key: <SITE_API_KEY>`

Body:
```json
{
  "leadText": "...",
  "company_name": "...",
  "industry": "...",
  "approximate_budget": "...",
  "expected_timeline": "..."
}
```

### Валидации и защита
- Rate limit: 10 заявки/IP/час
- Максимална дължина на `leadText`: 4000 символа
- Базови spam проверки
- user-friendly грешки (без stack traces)
- Няма auto-send към email/CRM
- Няма дългосрочно съхранение на съдържание от запитвания

## Файлова структура
- `server.js`
- `openai.js`
- `rateLimit.js`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `.env.example`

## Забележка за сигурност
`SITE_API_KEY` е прост shared secret за MVP публичен инструмент и не е пълна защита самостоятелно.
