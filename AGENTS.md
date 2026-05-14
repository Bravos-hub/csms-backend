# EVZone Backend — Agent Guide

This file is written for AI coding agents. It assumes you know nothing about the project. All statements below are derived from the actual source tree, configuration files, and CI/CD workflows.

---

## Project Overview

EVZone Backend is the microservices backend for the EVZone Charging Platform. It is a **NestJS monorepo** that exposes HTTP/REST APIs, handles WebSocket OCPP connections from EV chargers, and runs background workers driven by Kafka events.

The runtime is split into two primary deployable units:

- **`api`** — HTTP API server (port 3000) plus an embedded Kafka microservice for event consumption.
- **`worker`** — Background worker (port 3010) that processes command events, outbox messages, and telemetry storage maintenance.

The project language is **TypeScript** (target ES2023, module `nodenext`). All inline comments and documentation are in English.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | NestJS 11 (monorepo mode) |
| Language | TypeScript 5.7 |
| HTTP | Express (via `@nestjs/platform-express`) |
| WebSocket | `ws` / Socket.io (OCPP gateway) |
| Database | PostgreSQL + Prisma 5.22 (client + adapter-pg) |
| Message Broker | Apache Kafka via `kafkajs` |
| Cache | Redis via `ioredis` and `redis` |
| MQTT | `mqtt` package (edge adapters, battery-swap adapters) |
| Validation | `class-validator` + `class-transformer` |
| Auth | JWT in httpOnly cookies, bcrypt, speakeasy (TOTP), `@simplewebauthn/server` (passkeys) |
| Documentation | Swagger (`@nestjs/swagger`) |
| Testing | Jest + `ts-jest` + Supertest |
| Lint/Format | ESLint (`typescript-eslint`, type-checked) + Prettier |
| Runtime | Node.js 20 (Alpine in Docker) |

---

## Repository Structure

```
├── apps/
│   ├── api/                    # HTTP API + Kafka consumer
│   │   ├── src/
│   │   │   ├── main.ts         # Bootstrap (NestFactory + Kafka microservice)
│   │   │   ├── app.module.ts   # Root module (imports all feature modules)
│   │   │   ├── app.controller.ts
│   │   │   ├── prisma.module.ts
│   │   │   ├── prisma.service.ts
│   │   │   ├── common/         # Filters, interceptors, guards, observability, tenant resolution, utils
│   │   │   ├── contracts/      # Kafka topic contracts, shared types
│   │   │   ├── feature-flags/  # Feature flag module
│   │   │   ├── modules/        # Domain modules (~40+): auth, billing, booking, station, session, commands, payments, telemetry, etc.
│   │   │   ├── platform/       # Platform-level code
│   │   │   └── technicians/    # Technician-specific controllers
│   │   └── test/
│   │       ├── app.e2e-spec.ts
│   │       └── jest-e2e.json
│   └── worker/                 # Background worker
│       └── src/
│           ├── main.ts         # Bootstrap (listens on WORKER_PORT)
│           ├── app.module.ts
│           ├── config/
│           ├── contracts/
│           ├── modules/
│           │   ├── commands/   # Command events consumer, outbox worker, history cleanup, telemetry maintenance
│           │   ├── observability/
│           │   └── worker-health/
│           └── platform/
├── packages/
│   ├── domain/                 # Shared domain logic, RBAC helpers, types
│   │   └── src/
│   ├── db/                     # Prisma module, tenant routing, database service
│   │   └── src/
│   └── mqtt/                   # MQTT connection manager, tenant context, event publisher
│       └── src/
├── prisma/
│   ├── schema.prisma           # Single source of truth for DB schema
│   ├── migrations/             # Prisma migrate history
│   ├── seed.ts                 # Main seed script
│   ├── seed-geography.ts
│   ├── seed-orgs.ts
│   ├── backfill-*.ts           # Operational backfill scripts
│   └── hotfixes/               # SQL hotfixes for production schema drift
├── scripts/
│   ├── deploy-compose.sh       # Production Docker Compose deploy script
│   ├── ops/                    # Operational checks and diagnostics (TypeScript + PowerShell)
│   ├── prisma-check.js         # Prisma client drift / env guardrail
│   └── prisma-refresh.js       # Regenerate Prisma client
├── ops/
│   ├── loadtest/               # k6 load test scripts
│   ├── observability/          # Local observability stack (docker-compose)
│   └── dashboards/
├── docs/
│   ├── operations/             # Runbooks (payment, auth, incident, dead-letter replay, etc.)
│   └── contracts/              # Cross-repo contracts (events, OCPI internal)
├── .github/workflows/
│   ├── deploy-digitalocean-app.yml   # CI/CD: SSH deploy to DigitalOcean droplet
│   └── observability-smoke.yml       # CI smoke test for observability stack
├── docker-compose.yml          # api, worker, db-migrate services
├── Dockerfile                  # Multi-stage build (builder + runner)
├── nest-cli.json               # Monorepo project definitions (api, worker)
├── package.json                # Root package with workspaces: apps/*, packages/*
├── tsconfig.json               # Root TypeScript config with path aliases
├── eslint.config.mjs           # ESLint flat config (typescript-eslint + prettier)
├── .prettierrc                 # { singleQuote: true, trailingComma: "all" }
└── .env.example                # Committable environment template
```

### Path Aliases (TypeScript / Jest)

| Alias | Maps to |
|-------|---------|
| `@app/domain` | `packages/domain/src` |
| `@app/core` | `packages/domain/src` (legacy alias) |
| `@app/db` | `packages/db/src` |
| `@app/database` | `packages/db/src` (legacy alias) |
| `@app/mqtt` | `packages/mqtt/src` |

These are defined in `tsconfig.json` and mirrored in Jest `moduleNameMapper`.

---

## Build & Test Commands

All commands run from the repository root.

### Prerequisites
- Node.js 20+
- Docker Desktop (for infrastructure services)
- `.env` file created from `.env.example`

### Install & Generate
```bash
npm install
npx prisma generate
```

### Development
```bash
# Start API with watch (also runs Prisma checks first)
npm run start:dev

# Start API only
npm run start:api

# Start worker only
npm run start:worker

# Start with debug
npm run start:debug
```

### Build
```bash
# Runs Prisma check first, then builds api + worker
npm run build
```

### Prisma Guardrails
```bash
# Validate Prisma version, generated client integrity, runtime imports, env policy
npm run prisma:check

# Delete stale generated client and regenerate
npm run prisma:refresh
```
- `npm run start:dev` and `npm run build` both run `prisma:check` automatically.
- Keep `prisma/.env` empty; use only the root `.env` for runtime.

### Lint & Format
```bash
npm run lint          # ESLint with max-warnings 0
npm run format        # Prettier write on apps/**/*.ts and packages/**/*.ts
```

### Testing
```bash
# Unit tests (all *.spec.ts under apps/ and packages/)
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov

# Debug
npm run test:debug

# E2E tests (apps/api/test/*.e2e-spec.ts)
npm run test:e2e
```

### Load Testing
```bash
npm run loadtest:baseline
npm run loadtest:stress
npm run loadtest:spike
npm run loadtest:soak
```

### Operational Scripts
```bash
# Replay dead-letter Kafka messages
npm run replay:dead-letters

# Backfill user-org-region data
npm run backfill:user-org-region

# Seed database
npm run seed
```

---

## Code Style Guidelines

### Formatting
- **Prettier** enforces style: `singleQuote: true`, `trailingComma: "all"`.
- End-of-line is handled as `endOfLine: "auto"` in ESLint Prettier integration.

### Linting
- **ESLint flat config** (`eslint.config.mjs`) using `typescript-eslint` with `recommendedTypeChecked`.
- Type-aware linting is enabled (`projectService: true`).
- Key rule overrides:
  - `@typescript-eslint/no-explicit-any`: `off`
  - `@typescript-eslint/no-floating-promises`: `warn`
  - `@typescript-eslint/no-unsafe-argument`: `warn`
- `dist/` is ignored.

### TypeScript Settings
- `module`: `nodenext`, `moduleResolution`: `nodenext`
- `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`, `noFallthroughCasesInSwitch`: all `true`
- `forceConsistentCasingInFileNames`: `true`
- `skipLibCheck`: `true`

### Naming & Organization Conventions
- **Modules**: Each feature lives in its own NestJS module under `apps/api/src/modules/<feature>/`.
- **Files**: Controllers end in `.controller.ts`, services in `.service.ts`, modules in `.module.ts`, DTOs in `.dto.ts`, guards in `.guard.ts`.
- **Tests**: Unit tests co-located as `*.spec.ts` next to the file under test. E2E tests use `*.e2e-spec.ts` in `apps/api/test/`.
- **DTOs**: Defined with `class-validator` decorators for input validation.
- **Auth**: Controllers use `@UseGuards(JwtAuthGuard)` and `@ApiCookieAuth()` for Swagger.
- **Cookies**: Auth tokens are stored in httpOnly cookies (`evzone_access_token`, `evzone_refresh_token`).
- **Tenancy**: Most database operations go through tenant-routed Prisma clients. `TenantContextService` and `TenantResolutionService` manage per-request tenant resolution.
- **Feature Flags**: `FeatureFlagsModule` is imported globally; flags gate behavior at runtime.

---

## Testing Instructions

### Unit Tests
- Framework: **Jest** with `ts-jest`.
- Test regex: `.*\.spec\.ts$`
- Roots: `apps/` and `packages/`
- Coverage directory: `./coverage`
- Environment: `node`

### E2E Tests
- Config: `apps/api/test/jest-e2e.json`
- Test regex: `.e2e-spec.ts$`
- Only one e2e spec exists currently: `apps/api/test/app.e2e-spec.ts`.

### Writing New Tests
- Place `*.spec.ts` next to the source file.
- Use `@nestjs/testing` `Test.createTestingModule` for module compilation.
- Mock Prisma with a custom provider or jest mocks.
- For guards/pipes/filters, test in isolation and also via `createTestingModule`.

---

## Deployment Process

### Local Docker Compose
```bash
docker compose up -d   # Starts api, worker (needs external Postgres + Kafka + Redis)
```

### Production Deploy (DigitalOcean Droplet)
1. GitHub Actions workflow `.github/workflows/deploy-digitalocean-app.yml` triggers on `push` to `main`.
2. SSH into the droplet using secrets (`DROPLET_HOST`, `DROPLET_USER`, `DROPLET_SSH_KEY`).
3. Pull latest `main`, clean untracked files (preserving `.env` and `certs/`).
4. Run `scripts/deploy-compose.sh`:
   - Builds Docker image for `api` (with retries).
   - Runs `docker compose run --rm db-migrate` to apply Prisma migrations.
   - Starts `api` and `worker` containers.
5. Post-deploy health check on `http://127.0.0.1:3000/health` (24 attempts, 5s sleep).

### Manual Deploy Commands
```bash
chmod +x scripts/deploy-compose.sh
./scripts/deploy-compose.sh
```
Equivalent manual steps:
```bash
docker compose build api worker db-migrate
docker compose run --rm db-migrate
docker compose up -d api worker
```

### Incident Hotfix (Schema Drift)
If production fails with Prisma `P2022` for missing `stations` columns:
```bash
chmod +x scripts/hotfix-station-discovery-columns.sh
./scripts/hotfix-station-discovery-columns.sh
```
Then restart the API container.

---

## Environment & Configuration

- **Active env file**: `.env` (root only). `prisma/.env` must be kept empty.
- **Template**: `.env.example` (committable, safe defaults).
- **Config loading**: `ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })`.

### Critical Environment Variables
| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` / `production` |
| `PORT` | API port (default 3000) |
| `WORKER_PORT` | Worker port (default 3010) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `KAFKA_BROKERS` | Kafka broker list |
| `JWT_SECRET` | JWT signing secret |
| `FRONTEND_URL` | CORS / redirect origin |
| `OCPP_PUBLIC_WS_BASE_URL` | Public WebSocket URL for chargers |

### Feature Flags (runtime)
- `PAYMENT_ORCHESTRATION_ENABLED`
- `FEATURE_OCPP_FIRMWARE_COMMANDS_ENABLED`
- `FEATURE_OCPP_FIRMWARE_STATUS_PERSIST_ENABLED`
- `ENERGY_SIMULATION_ENABLED`
- `ATTENDANT_SYNC_ENABLED`

---

## Security Considerations

- **Authentication**: JWT access + refresh tokens stored in **httpOnly cookies** (not localStorage). CSRF protection relies on SameSite lax + CORS origin allowlist.
- **Rate Limiting**: `@nestjs/throttler` applied globally (default 120 requests per 60s). Use `@SkipThrottle()` or `@Throttle()` to override per endpoint.
- **Database**: Prisma query engine with parameterized queries. No raw SQL in business logic unless strictly necessary.
- **Secrets**: Never commit `.env`. `.env.example` is the only committable template.
- **Payment Webhooks**: Public endpoints (`/api/v1/payments/webhooks/*`) verify signatures using provider-specific secrets.
- **Tenant Isolation**: All DB queries are routed through tenant-aware Prisma clients. Never execute cross-tenant queries.
- **Kafka SSL/SASL**: Optional via `KAFKA_SSL`, `KAFKA_SSL_REJECT_UNAUTHORIZED`, and SASL env vars.

---

## Operational Notes

### Observability (Local)
```bash
npm run ops:obs:up      # Start local observability stack
npm run ops:obs:smoke   # Run smoke checks
```

### Dead Letter Replay
```bash
npm run replay:dead-letters
```

### Team Assignment Diagnostics
```bash
npm run ops:check-team-user-assignment -- --identifier <email>
npm run ops:check-station-team-consistency
```

### EVZONE WORLD Consistency Recovery
```bash
npm run backfill:user-org-region
npm run ops:check-platform-user-org-consistency
npm run ops:repair-platform-user-org-consistency   # backfill + check in one shot
```

### Attendant Login Debugging
```bash
npx tsx ./scripts/ops/check-attendant-login-state.ts --identifier <email>
```

### Prisma Drift Recovery
Always run `npm run prisma:check` before starting dev or building. If the client is stale, run `npm run prisma:refresh`.
