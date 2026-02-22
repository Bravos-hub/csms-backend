# CORS Cookie CSRF Posture

This document defines API browser security posture for multi-frontend EVZone usage.

## Current Controls

1. CORS is allowlist-based via `CORS_ORIGINS`.
2. Credentials are enabled (`Access-Control-Allow-Credentials: true`).
3. Startup guardrails fail fast when:
   - `CORS_ORIGINS` is empty
   - wildcard `*` is configured
   - invalid/non-http(s) origins are configured
   - production origins are non-https (except localhost)
4. Auth cookies are:
   - `httpOnly: true`
   - `secure: true` in production
   - `sameSite: strict` in production, `lax` in non-production

## Frontend Classes

- Portal/Admin/Operator web apps: must be explicitly listed in `CORS_ORIGINS`.
- Public web frontends: must be explicitly listed in `CORS_ORIGINS`.
- Mobile/native clients: unaffected by browser CORS enforcement.

## Operational Guidance

1. Do not use `*` for `CORS_ORIGINS`.
2. Keep production frontend origins on `https`.
3. Keep `NODE_ENV=production` in production so secure cookie flags are applied.
4. Re-validate auth login/refresh/logout flows after origin changes.

## Validation Checklist

1. API starts successfully with configured `CORS_ORIGINS`.
2. Browser preflight passes only for approved origins.
3. Cross-origin unapproved origins are rejected.
4. Auth cookies are marked `HttpOnly`, `Secure` (prod), and expected `SameSite`.
