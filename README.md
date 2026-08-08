# Fahmo AI

Fahmo AI превращает PDF, изображения и текст в понятное объяснение, список действий, важные даты, суммы, места и контакты.

Репозиторий содержит два production-компонента:

- frontend — адаптивная PWA без runtime-зависимостей, размещаемая на Vercel;
- `back/` — Node.js/TypeScript API, фоновые обработчики, Prisma/PostgreSQL и AI/OCR-провайдеры для Railway.

## Возможности

- русский, тоҷикӣ и English; светлая, тёмная и системная темы;
- PDF, PNG, JPG, WEBP и TXT до 10 МБ, до 10 страниц, текст до 50 000 символов;
- камера, drag-and-drop, clipboard, порядок страниц, поворот, обрезка и preview;
- локальный текстовый анализ и серверный AI/OCR через единый `/api/v1`;
- устойчивый прогресс, уточнения, задачи с optimistic concurrency и напоминания;
- PDF/ICS/data export, публичные отзываемые ссылки и локальная история;
- PWA/offline app shell, keyboard focus, reduced motion и отдельная mobile-композиция;
- server-side ownership, Origin/CSRF-проверка, лимиты, транзакции и идемпотентность.

Ключи AI-провайдеров никогда не передаются во frontend. `config.js` и переменные `NEXT_PUBLIC_*` являются публичной конфигурацией.

## Локальный запуск

Требуется Node.js 20+ и PostgreSQL для backend.

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd back
copy .env.example .env
npm install
npm run prisma:deploy
npm start
```

По умолчанию frontend доступен на `http://127.0.0.1:4173`, backend — на `http://127.0.0.1:8787`.

## Проверки

Frontend:

```bash
npm run lint
npm run typecheck
npm run verify
npm run build
npm run smoke
npm run test:e2e
```

Backend:

```bash
cd back
npm run lint
npm run build
npm run prisma:validate
npm test
```

HTTP integration smoke запускается против работающего backend:

```bash
cd back
npm run smoke:http
```

## Production-конфигурация

Frontend build использует:

```text
NEXT_PUBLIC_API_MODE=http
NEXT_PUBLIC_API_BASE_URL=https://<railway-domain>
NEXT_PUBLIC_API_PREFIX=/api/v1
NEXT_PUBLIC_APP_URL=https://<vercel-domain>
```

Production build прекращается с ошибкой, если API URL не HTTPS, указывает на localhost или включён локальный режим.

Backend использует `back/.env.example` как перечень переменных. Для Railway обязательны PostgreSQL `DATABASE_URL`, криптографические секреты, минимум один AI-провайдер, `FRONTEND_ORIGIN`, CORS origins и постоянный `STORAGE_DIR` (обычно путь подключённого volume).

Endpoints готовности: `GET /api/health` и `GET /api/ready`. Экспортируемые схемы ответов находятся в [OpenAPI schemas](back/openapi/schemas).

## Структура

```text
src/                 frontend core, domain, pages и UI
public/assets/       PWA icons и продуктовые изображения
tests/               frontend unit и browser E2E
scripts/             build, syntax и smoke проверки
back/src/            HTTP, application, domain и infrastructure
back/prisma/         схема и миграции PostgreSQL
back/tests/          backend unit/integration-level tests
back/openapi/        API contract
```

Vercel использует `vercel.json` и собирает `dist/`. Railway использует `back/railway.json`, применяет Prisma migrations перед запуском и проверяет `/api/ready`.
