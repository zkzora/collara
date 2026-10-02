# API reference

The Collara API is a Fastify 5 service (`apps/api`). Browsers reach it only through the web app's same-origin `/api/*` proxy (`apps/web/src/app/api/[...path]/route.ts`); the API listens on `127.0.0.1:4000` in development. Synthetic demo data only; nothing here is a production security assurance.

## Viewing the OpenAPI document

- **Interactive UI:** `http://127.0.0.1:4000/api/docs` while the API runs (`pnpm dev:api`), also reachable through the web proxy at `http://localhost:3000/api/docs`. The raw document is served at `/api/docs/json` (and `/api/docs/yaml`) by `@fastify/swagger-ui`. The docs are served in UI_MOCK too, without a database.
- **Committed file:** [`apps/api/openapi.json`](../apps/api/openapi.json) (OpenAPI 3.0.3, generated from the route Zod schemas).

### Exporting `apps/api/openapi.json`

```sh
pnpm --filter @collara/api openapi:export
```

The script (`apps/api/scripts/export-openapi.ts`, run with tsx) builds the app in memory with `COLLARA_MODE=LOCALNET` and a database stand-in that throws on any query, calls `app.swagger()` and writes the file. It needs **no running server, database, storage or ledger**. Last run on 2026-10-02: 66 paths, 71 operations; two consecutive runs produced byte-identical files (SHA-256 `ee6af6a5…5de3`). Re-export and commit after any route or schema change.

The document lists success responses only. Error responses are not declared per operation; they all use the problem shape below.

### Operations by tag (from the export)

| Tag | Operations |
|---|---|
| system | `GET /api/system/health` |
| auth | `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout` |
| session | `GET /api/me` |
| demo | `GET /api/demo/personas`, `POST /api/demo/sessions` (404 unless `DEMO_SESSIONS_ENABLED=true`) |
| public | `POST /api/pilot-requests` (rate-limited per client IP) |
| commands | `GET /api/commands/{id}` |
| evidence | `POST /api/evidence/upload-intents`, `PUT /api/evidence/{id}/content`, `POST /api/evidence/{id}/finalize`, `GET /api/evidence/{id}`, `GET /api/evidence/{id}/download` |
| cases | `GET/POST /api/cases`, `GET /api/cases/{id}`, `GET /api/cases/{id}/evidence`, `POST /api/cases/{id}/sharing`, `POST /api/cases/{id}/verification-requests` |
| assets | `GET/POST /api/assets`, `GET /api/assets/{id}`, `GET /api/assets/{id}/evidence`, `POST /api/assets/{id}/verification-requests` |
| verifications | `GET /api/verifications`, `GET /api/verifications/{id}`, `GET /api/attestations/{id}`, `POST /api/verifications/{id}/assignment`, `…/change-requests`, `…/rejection`, `…/attestations`, `…/evidence-submissions` |
| reviews | `GET /api/reviews`, `GET /api/reviews/{id}`, `POST /api/cases/{id}/assessments`, `POST /api/reviews/{id}/submit-for-approval`, `…/decision`, `…/information-requests` |
| proposals | `GET /api/proposals/{id}`, `POST /api/cases/{id}/proposals`, `POST /api/proposals/{id}/acceptance`, `…/decline`, `…/withdraw`, `…/activation-authorization` |
| pledges | `GET /api/pledges`, `GET /api/pledges/{id}`, `POST /api/cases/{id}/pledge-activation`, `POST /api/pledges/{id}/release-requests` |
| release | `GET /api/release-requests/{id}`, `POST /api/release-requests/{id}/decision`, `…/information-requests`, `…/responses`, `…/withdraw` |
| access | `GET/POST /api/access-grants`, `POST /api/access-grants/{id}/revoke` |
| audit | `GET /api/audit/events`, `POST /api/audit/grants`, `POST /api/audit/grants/{id}/revoke` |
| reports | `GET/POST /api/reports`, `GET /api/reports/{id}/download` |
| governance | `GET /api/verifiers`, `GET /api/governance/state`, `GET/POST /api/governance/proposals`, `GET /api/governance/proposals/{id}`, `POST …/confirmations`, `…/execute`, `…/cancel` |

Who may call what is in [`docs/permissions.md`](permissions.md).

## Authentication

- **Session cookie.** The API keeps sessions server-side (PostgreSQL) and sets an HttpOnly, `SameSite=Lax` cookie: `collara_sid`, or `__Host-collara_sid` (Secure) when `COOKIE_SECURE=true`. Sessions rotate on login and persona switch and are deleted on logout. OIDC and ledger tokens never reach the browser.
- **OIDC.** `GET /api/auth/login` starts an Authorization Code + PKCE flow against `COLLARA_OIDC_ISSUER` (Keycloak locally) and `GET /api/auth/callback` completes it. Login is unavailable unless the issuer and client secret are configured.
- **Demo sessions (demo environments only).** With `DEMO_SESSIONS_ENABLED=true`, `GET /api/demo/personas` lists the seeded synthetic personas and `POST /api/demo/sessions` starts an isolated session as one of them. This is not an authentication mechanism and must stay disabled anywhere reachable.
- **Authority.** Every request resolves session → user → membership → mandates → party bindings on the server. Organization, party or role values in headers, query or body are never trusted. A browser `Authorization` header is dropped by the web proxy.

## CSRF protection

There is no CSRF token. For unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) the API (`apps/api/src/plugins/security.ts`):

1. accepts `Sec-Fetch-Site: same-origin` or `none` and rejects any other value;
2. without Fetch Metadata, requires an `Origin` that equals `PUBLIC_ORIGIN`, one of `CSRF_TRUSTED_ORIGINS`, or the request's own host;
3. lets requests with neither header through: they come from non-browser clients that carry no ambient browser cookies.

Combined with the `SameSite=Lax` cookie. A rejected request gets 403 `forbidden` with `Cross-site requests are not accepted.`

## Idempotency

Every mutation except logout, demo sessions and the pilot form requires an **`Idempotency-Key`** header of 8 to 200 characters (optional on `POST /api/pilot-requests`). The API stores a durable command record scoped to (actor, organization, operation, payload hash):

- the same key with the same payload replays the stored outcome without resubmitting;
- the same key with a different payload answers 409 `idempotency_conflict`;
- a missing or invalid key answers 400 `validation_error`.

The ledger `commandId` is derived deterministically from the record, so a resubmission after a timeout is deduplicated by Canton.

## Responses of ledger-backed mutations

| Outcome | HTTP | Body |
|---|---|---|
| Committed (has an `updateId`) | 200 | `{ command, result? }` |
| Submitted, or outcome unknown | 202 | `{ command }`; poll `GET /api/commands/{id}` |
| Rejected by the ledger | 409 `state_conflict` | problem + `command` (an authorization rejection is 404 `unavailable`) |
| Ledger unreachable / no binding | 503 `ledger_unavailable` | problem + `command`; nothing is simulated |
| Application-record operations (case creation, drafts, reports, evidence upload) | 200 / 201 | no ledger transaction |

`command` is the domain `CommandStatus`: `commandId`, `operation`, `target`, `state` (`PREPARED`, `SUBMITTED`, `COMMITTED`, `PROJECTED`, `REJECTED`, `FAILED`, `UNKNOWN_OUTCOME`, `PROJECTION_DELAYED`), `simulated` (true only in UI_MOCK), `updateId` and `completionOffset` (only for a real commit), `message`, timestamps. Committed success is shown to users only with an `updateId`. `GET /api/commands/{id}` is visible only to the actor and organization that issued the command.

## Error shape

All errors are RFC 9457 problem details with content type `application/problem+json` (`packages/domain/src/dto.ts`, `ApiProblemSchema`):

```json
{
  "type": "urn:collara:problem:unavailable",
  "title": "Unavailable",
  "status": 404,
  "code": "unavailable",
  "detail": "This record is unavailable to your account.",
  "instance": "urn:collara:request:<request id>",
  "issues": [{ "path": "body.valuation", "message": "…" }]
}
```

| `code` | Status | When |
|---|---|---|
| `unavailable` | 404 | Unknown id **or** a record the caller is not related to; the two are indistinguishable by design. Also unknown routes. |
| `forbidden` | 403 | Related to the record, but the role or mandate does not permit the action; cross-site requests |
| `unauthenticated` | 401 | No session |
| `state_conflict` | 409 | The workflow state changed or the ledger rejected the command |
| `idempotency_conflict` | 409 | Key reused with a different payload |
| `validation_error` | 400 (or the original 4xx, e.g. 413, 415) | Schema validation (`issues` lists the paths), malformed JSON, unsupported media type, payload too large |
| `rate_limited` | 429 | Pilot form rate limit |
| `ledger_unavailable` | 503 | Ledger or binding unavailable; no state change recorded |
| `internal_error` | 500 / 503 | Unexpected error (no stack trace), or storage/database unavailable (503) |

`instance` carries the request id, which is also returned in the `x-request-id` header. Every API response is `Cache-Control: private, no-store` unless a route sets otherwise, with `Vary: Cookie`.

## Health

`GET /api/system/health` always answers 200; `status` is `ok`, `degraded` (storage, ledger or projection worker) or `unavailable` (database down). In LOCALNET it reports the exact ledger topology. The worker serves `GET /healthz` on port 4100 with its projection checkpoint, lag and reset state.
