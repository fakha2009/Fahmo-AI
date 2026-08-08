# Структура backend Fahmo AI

```text
src/
  ai/                    gateway, providers, prompts, normalization
  config/                environment schema and validated config
  database/              Prisma client and repositories
  http/                  server, router, request context, routes, mappers
  modules/               domain and application services by capability
  monitoring/            structured logging and operational signals
  security/              encryption and rate limiting
  storage/               private storage ports and adapters
  validation/            Zod request/response/AI schemas
  workers/               queue runners and cleanup logic
prisma/
  schema.prisma          source of truth for relational data
  migrations/            forward migrations
tests/unit/              isolated and repository/service contract tests
openapi/schemas/         exported public response schemas
scripts/                 schema export and HTTP smoke flow
```

## Зависимости слоёв

- HTTP зависит от application contracts, validation и shared errors.
- Application services зависят от repository/storage/provider interfaces.
- Infrastructure реализует эти interfaces и не проникает в domain.
- AI providers вызываются только через gateway.
- Frontend не импортирует backend-код и работает только через `/api/v1`.

Новые route handlers регистрируются в `src/http/server.ts`. Бизнес-правила не размещаются в handlers. Новая таблица требует Prisma migration и repository-level проверки ownership/concurrency.
