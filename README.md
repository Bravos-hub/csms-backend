# ⚡ EVZone Backend

The microservices backend for the EVZone Charging Platform. Built with **NestJS**, **Kafka**, **PostgreSQL**, and **Redis**.

## 🏗️ Architecture

The system follows an event-driven microservices architecture.

```mermaid
graph TD
    subgraph Clients
        App[Web/Mobile App]
        Charger[EV Charger (OCPP)]
    end

    subgraph Entry Points
        AuthAPI[Auth Service :3000]
        Gateway[OCPP Gateway :3003]
        BillingAPI[Billing Service :3004]
        BookingAPI[Booking Service :3005]
        MaintAPI[Maintenance Service :3006]
        NotifAPI[Notification Service :3007]
        AnalyticsAPI[Analytics Service :3008]
    end

    subgraph Core Services
        StationSvc[Station Service :3001]
        SessionSvc[Session Service :3002]
    end

    subgraph Infrastructure
        Kafka{{Kafka Event Bus}}
        DB[(PostgreSQL)]
        Redis[(Redis Cache)]
    end

    %% Flows
    App -->|HTTP/REST| AuthAPI
    App -->|HTTP/REST| BillingAPI
    App -->|HTTP/REST| BookingAPI
    App -->|HTTP/REST| MaintAPI

    Charger -->|WebSocket| Gateway

    Gateway -->|Produces 'ocpp.message'| Kafka

    Kafka -->|Consumes| StationSvc
    Kafka -->|Consumes| SessionSvc
    Kafka -->|Consumes| BillingAPI

    StationSvc -->|Read/Write| DB
    SessionSvc -->|Read/Write| DB
    AuthAPI -->|Read/Write| DB

    AuthAPI -.->|Auth Token| App
```

## 📦 Microservices

| Service             | Port   | Description                                                        |
| :------------------ | :----- | :----------------------------------------------------------------- |
| **Auth Service**    | `3000` | User management, **Cookie-based Authentication (httpOnly)**, RBAC. |
| **Station Service** | `3001` | Charger registry, status tracking, auto-provisioning.              |
| **Session Service** | `3002` | Charging session tracking (Start/Stop transactions).               |
| **OCPP Gateway**    | `3003` | WebSocket handling for OCPP 1.6/2.0 chargers.                      |
| **Billing Service** | `3004` | Wallets, Tariffs, Invoicing, Payments.                             |
| **Booking Service** | `3005` | Charging slot reservations.                                        |
| **Maintenance**     | `3006` | Incident reporting, ticketing, technician dispatch.                |
| **Notification**    | `3007` | Centralized alerts (Push, Email, SMS).                             |
| **Analytics**       | `3008` | Reporting and data aggregation.                                    |

## 🚀 Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (Running)
- [Node.js](https://nodejs.org/) (v16+)

### Environment Variables

Use [`.env.example`](/d:/Dev/EVZONE/evzone-backend/.env.example) as the full safe template, and keep real secrets only in `.env`.

The runtime contract is now:

- `.env`: the only active runtime file for API, worker, and ops scripts
- `.env.example`: the only committable env template

Key values to set in `.env` before running:

```env
NODE_ENV=development
PORT=3000
JWT_SECRET=TODO_SET_JWT_SECRET
DATABASE_URL=postgresql://user:password@localhost:5432/evzone
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092
FRONTEND_URL=http://localhost:5173
OCPP_PUBLIC_WS_BASE_URL=wss://ocpp.evzonecharging.com
```

### Payment Orchestration (China vs Global)

Payment routing is feature-flagged and market-aware:

- Set `PAYMENT_ORCHESTRATION_ENABLED=true` to enable provider-backed orchestration.
- Market split:
  - `CHINA` for Mainland China (`CN`).
  - `GLOBAL` for all other countries.
- Provider chain:
  - China: `LianLian -> Alipay`
  - Global: `Stripe -> Flutterwave`
- Webhook endpoints (public):
  - `POST /api/v1/payments/webhooks/stripe`
  - `POST /api/v1/payments/webhooks/flutterwave`
  - `POST /api/v1/payments/webhooks/alipay`
  - `POST /api/v1/payments/webhooks/lianlian`
- Wallet top-ups are now settled asynchronously in orchestration mode:
  - top-up creates pending payment + pending credit transaction
  - wallet is credited only after verified provider webhook/reconciliation success
  - failed/canceled webhook events do not credit wallet
- Legacy health URL checks remain only for compatibility when orchestration is disabled:
  - `PAYMENT_HEALTHCHECK_URL`, `PAYMENT_HEALTHCHECK_BEARER_TOKEN`, `PAYMENT_HEALTHCHECK_TIMEOUT_MS`

Operational runbook: [`docs/operations/payment-orchestration-runbook.md`](./docs/operations/payment-orchestration-runbook.md)

### Geo-Routed Messaging (Email + SMS)

Provider selection is now **per recipient**, not global.

Routing matrix:

- China: `Submail` for SMS and email, no fallback.
- Africa: SMS `Africa's Talking -> Twilio`; email `Twilio SendGrid -> Submail`.
- Other regions: SMS `Twilio -> Submail`; email `Twilio SendGrid -> Submail`.
- Unknown geography: defaults to Twilio-first routing.

Geography resolution order:

1. Delivery context (`zoneId`, `country`, `region`, `userId`) when provided by caller.
2. User lookup by recipient email (email flows).
3. SMS-only heuristic for China when phone starts with `+86` or `0086`.
4. Unknown -> Twilio-first fallback chain.

Implementation notes:

- SMTP/Gmail test routing is removed from active delivery logic.
- `POST /api/v1/notifications/sms` accepts optional context fields: `userId`, `zoneId`, `country`, `region`.

### Prisma Client Drift Recovery

Use `.env` as the active backend environment source.

- Keep `prisma/.env` empty (no active `KEY=value` entries).
- If `prisma/.env` has active values, Prisma guardrails will fail fast.

Commands:

```bash
npm run prisma:check
npm run prisma:refresh
```

What they do:

- `npm run prisma:check`: validates Prisma package version alignment, generated client integrity, runtime import targets, and env policy.
- `npm run prisma:refresh`: deletes stale generated client artifacts and regenerates Prisma client with the local pinned CLI.

Automatic guardrails:

- `npm run start:dev` now runs Prisma checks first.
- `npm run build` now runs Prisma checks first.

### Quick Start (Windows)

Use the startup script with `.env`:

```powershell
./startup.ps1
./startup.ps1 -SkipDocker
```

### Manual Start

1.  **Start Infrastructure:**

    ```bash
    docker-compose up -d
    ```

2.  **Start a Service (Example):**
    ```bash
    npx nest start station-service --watch
    ```

## 🧪 Verification & Documentation

### API Documentation (Swagger)

- URL: [`http://localhost:3000/api/docs`](http://localhost:3000/api/docs)
- Features: Full API reference with cookie-based auth support.

### Auth Metrics

- URL: [`http://localhost:3000/api/v1/auth/metrics`](http://localhost:3000/api/v1/auth/metrics)
- Provides: Login/Logout/Refresh success rates and latency.

### Observability Smoke (Local + CI)

Quick local run:

```powershell
npm run ops:obs:up
npm run ops:obs:smoke
```

Direct script invocation:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/ops/observability-smoke-check.ps1 `
  -ApiBaseUrl http://localhost:3000 `
  -WorkerBaseUrl http://localhost:3010 `
  -PrometheusBaseUrl http://localhost:9090 `
  -TimeoutSeconds 10
```

GitHub Actions workflow:

- File: `.github/workflows/observability-smoke.yml`
- Provisions Postgres + Kafka (`bitnamilegacy/kafka:3.7`) as workflow services.
- Sets `MEDIA_PROVIDER=disabled` for CI startup so Cloudinary secrets are not required for smoke runs.
- Waits one initial Prometheus scrape cycle (`sleep 20`) before asserting target health.
- Uploads `api.log` and `worker.log` artifacts on failure.

Detailed runbook: [`docs/operations/observability-local-setup.md`](./docs/operations/observability-local-setup.md)

### Manual Verification

1.  **Auth API**:
    - POST `http://localhost:3000/api/v1/auth/login`
    - Body: `{"email": "admin@test.com", "password": "pass"}`
    - **Result**: 200 OK + `evzone_access_token` and `evzone_refresh_token` cookies (httpOnly).

2.  **OCPP Connection**:
    - Connect WebSocket Client to `ws://localhost:3003/ocpp/TEST_CP_001`
    - Protocol: `ocpp1.6`
    - Send `BootNotification` payload.

3.  **Check Logs**:
    - Observe `station-service` logs to see the new charger being auto-provisioned upon connection.

### Attendant Login State Check (Read-only)

Use this helper when credentials appear correct but attendant login still fails:

```bash
npx tsx ./scripts/ops/check-attendant-login-state.ts --identifier test1@evzonecharging.com
```

What it verifies:

- user existence by email/phone
- role, status, and password-hash presence
- attendant assignment existence
- active assignment window validity (`isActive`, `activeFrom`, `activeTo`)

### Team Assignment Ops Checks (Read-only)

Use these checks for station-team rollout diagnostics:

```bash
npm run ops:check-team-user-assignment -- --identifier test1@evzonecharging.com
npm run ops:check-station-team-consistency
```

What they verify:

- member existence, role/status, and organization membership
- station-team assignments vs attendant projection (`attendant_assignments`)
- active users without active station-team assignments (`Active-Unassigned` risk)

### Team Assignment Runbook

1. Invite with station-role seed:

- Call `POST /api/v1/users/team/invite` with at least one `initialAssignments` row.

2. Legacy invite activation:

- If `initialAssignmentsJson` is missing on invitation, activation keeps the user active but unassigned.

3. Resolve `Active-Unassigned`:

- Use `PUT /api/v1/users/team/:id/assignments` to replace assignments with at least one active row.
- For attendant rows, projection sync updates `attendant_assignments` automatically.

4. Verify projection:

- Run `npm run ops:check-station-team-consistency` and confirm mismatch counts are zero.

### EVZONE WORLD Consistency Recovery

Use these when invite fails because inviter lacks organization scope:

```bash
npm run backfill:user-org-region
npm run ops:check-platform-user-org-consistency
```

One-shot repair + verification:

```bash
npm run ops:repair-platform-user-org-consistency
```

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) (Monorepo Mode)
- **Language**: TypeScript
- **Authentication**: JWT in httpOnly Cookies + Refresh Token Revocation
- **Database**: PostgreSQL + Prisma
- **Message Broker**: Apache Kafka
- **Cache**: Redis
- **Validation**: class-validator
- **Documentation**: Swagger, Mermaid, Markdown

## Production Deploy (Docker Compose)

Use this sequence to guarantee database migrations are applied before the API starts:

```bash
chmod +x scripts/deploy-compose.sh
./scripts/deploy-compose.sh
```

Equivalent manual commands:

```bash
docker compose build api worker db-migrate
docker compose run --rm db-migrate
docker compose up -d api worker
```

## Incident Hotfix (Stations Schema Drift)

If production is failing with Prisma `P2022` for missing `stations` columns, apply the SQL hotfix:

```bash
chmod +x scripts/hotfix-station-discovery-columns.sh ]
./scripts/hotfix-station-discovery-columns.sh
```

Manual equivalent:

```bash
docker compose exec api sh -lc "npx prisma db execute --url \"$DATABASE_URL\" --file prisma/hotfixes/20260210_station_discovery_columns_hotfix.sql"
```

Then restart API and verify:

```bash
docker compose restart api
docker logs csms-backend-api-1 --tail 100
```
