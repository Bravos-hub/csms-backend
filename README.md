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

| Service | Port | Description |
| :--- | :--- | :--- |
| **Auth Service** | `3000` | User management, **Cookie-based Authentication (httpOnly)**, RBAC. |
| **Station Service** | `3001` | Charger registry, status tracking, auto-provisioning. |
| **Session Service** | `3002` | Charging session tracking (Start/Stop transactions). |
| **OCPP Gateway** | `3003` | WebSocket handling for OCPP 1.6/2.0 chargers. |
| **Billing Service** | `3004` | Wallets, Tariffs, Invoicing, Payments. |
| **Booking Service** | `3005` | Charging slot reservations. |
| **Maintenance** | `3006` | Incident reporting, ticketing, technician dispatch. |
| **Notification** | `3007` | Centralized alerts (Push, Email, SMS). |
| **Analytics** | `3008` | Reporting and data aggregation. |

## 🚀 Getting Started

### Prerequisites
*   [Docker Desktop](https://www.docker.com/products/docker-desktop) (Running)
*   [Node.js](https://nodejs.org/) (v16+)

### Environment Variables

Ensure `.env` contains:
```env
# Authentication
JWT_SECRET=your-secure-secret
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
CORS_ORIGINS=http://localhost:5173,https://portal.evzonecharging.com

# Database & Infrastructure
DATABASE_URL="postgresql://user:pass@localhost:5432/evzone"
KAFKA_BROKERS=localhost:9092
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Quick Start (Windows)

We provide a **Master Startup Script** that launches:
1.  Docker Infrastructure (Postgres, Kafka, Zookeeper, Redis).
2.  All 9 Microservices in separate terminal windows.

```powershell
./startup.ps1
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
*   URL: [`http://localhost:3000/api/docs`](http://localhost:3000/api/docs)
*   Features: Full API reference with cookie-based auth support.

### Auth Metrics
*   URL: [`http://localhost:3000/api/v1/auth/metrics`](http://localhost:3000/api/v1/auth/metrics)
*   Provides: Login/Logout/Refresh success rates and latency.

### Manual Verification
1.  **Auth API**:
    *   POST `http://localhost:3000/api/v1/auth/login`
    *   Body: `{"email": "admin@test.com", "password": "pass"}`
    *   **Result**: 200 OK + `evzone_access_token` and `evzone_refresh_token` cookies (httpOnly).

2.  **OCPP Connection**:
    *   Connect WebSocket Client to `ws://localhost:3003/ocpp/TEST_CP_001`
    *   Protocol: `ocpp1.6`
    *   Send `BootNotification` payload.

3.  **Check Logs**:
    *   Observe `station-service` logs to see the new charger being auto-provisioned upon connection.

## 🛠️ Tech Stack

*   **Framework**: [NestJS](https://nestjs.com/) (Monorepo Mode)
*   **Language**: TypeScript
*   **Authentication**: JWT in httpOnly Cookies + Refresh Token Revocation
*   **Database**: PostgreSQL + TypeORM
*   **Message Broker**: Apache Kafka
*   **Cache**: Redis
*   **Validation**: class-validator
*   **Documentation**: Swagger, Mermaid, Markdown

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
chmod +x scripts/hotfix-station-discovery-columns.sh
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

If you see `PrismaClientInitializationError` with `libssl.so.1.1` missing, rebuild images after pulling latest Dockerfile changes, then re-run migrate:

```bash
docker compose build --no-cache api worker db-migrate
docker compose run --rm db-migrate
docker compose up -d api worker
```
