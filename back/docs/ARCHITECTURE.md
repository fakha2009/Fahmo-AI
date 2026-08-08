# Архитектура backend Fahmo AI

Backend — модульный Node.js/TypeScript сервис с PostgreSQL/Prisma, HTTP API и встроенными фоновыми обработчиками. Один процесс обслуживает API, забирает анализы из очереди БД и формирует экспорты; это соответствует одному Railway service и исключает ситуацию, когда запрос принят, но worker не запущен.

## Границы системы

```text
Vercel PWA
  → HTTPS /api/v1
  → HTTP routes + Zod validation + session ownership
  → application services
  → Prisma repositories / AI gateway / private storage
  → PostgreSQL / Gemini или DeepSeek / Railway volume
```

- `src/http` отвечает только за transport, validation, auth/ownership и response mapping.
- `src/modules/*/application` содержит сценарии и инварианты.
- `src/database/repositories` реализует атомарное хранение и optimistic concurrency.
- `src/ai` изолирует провайдеров, retry/fallback, нормализацию и проверку AI-ответа.
- `src/storage` хранит staging, preview и export без публичной раздачи исходников.

## Контракт

Все продуктовые endpoints используют `/api/v1`: сессия, анализы, задачи, напоминания, уточнения, shares, preferences, providers и exports. Служебные endpoints: `/api/health` и `/api/ready`.

Анонимная сессия передаётся HttpOnly cookie и дублируется в `X-Session-Token` для браузеров, ограничивающих cross-site cookies. CORS разрешает только точные origins. Cross-site запрос без доверенного `Origin` отклоняется до router dispatch.

## Целостность и конкурентность

- tenant isolation и владение проверяются на сервере;
- mutations задач используют revision/optimistic concurrency;
- создание анализа и напоминаний поддерживает idempotency keys;
- AI-задачи materialize в таблицу `Task` ровно один раз: `O(T + E)`, где `T` — задачи AI, `E` — уже сохранённые задачи;
- list endpoints ограничены, отсутствуют неограниченные выборки;
- soft delete сохраняет ссылочную целостность истории;
- migrations применяются до старта production процесса.

## Надёжность

AI gateway применяет timeouts, ограниченные retries и provider fallback. Частичный валидный результат сохраняется при `needs_clarification`. Export jobs имеют TTL и выдаются только владельцу. `/api/ready` проверяет PostgreSQL и storage без платного AI-вызова.

На Railway `STORAGE_DIR` должен указывать на подключённый volume. Секреты задаются только platform variables; в frontend и Git они не попадают.
