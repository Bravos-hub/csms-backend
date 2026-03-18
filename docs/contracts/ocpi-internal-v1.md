# OCPI Internal Contracts (Core v1)

Source of truth for `ocpi-gateway -> evzone-backend` service-authenticated routes.

## Required Routes

- `POST /api/v1/internal/ocpi/commands/requests`
- `POST /api/v1/internal/ocpi/commands/results`
- `PUT /api/v1/internal/ocpi/sessions/:sessionId/charging-preferences`
- `POST /api/v1/internal/ocpi/partner-tariffs/delete`
- `GET /api/v1/internal/ocpi/cdrs/:cdrId`

## Existing Core Routes

- `GET /api/v1/internal/ocpi/locations`
- `GET /api/v1/internal/ocpi/locations/:id`
- `POST|PATCH /api/v1/internal/ocpi/partner-locations`
- `GET /api/v1/internal/ocpi/tariffs`
- `POST /api/v1/internal/ocpi/partner-tariffs`
- `GET|POST /api/v1/internal/ocpi/tokens`
- `GET|POST /api/v1/internal/ocpi/partner-tokens`
- `POST /api/v1/internal/ocpi/tokens/authorize`
- `GET /api/v1/internal/ocpi/sessions`
- `POST /api/v1/internal/ocpi/partner-sessions`
- `GET|POST /api/v1/internal/ocpi/cdrs`
- `GET|POST|PATCH /api/v1/internal/ocpi/partners`

## Deferred (Deterministic Not Supported)

- ChargingProfiles module routes
- HubClientInfo module routes

These currently return `501` with `MODULE_NOT_SUPPORTED`.
