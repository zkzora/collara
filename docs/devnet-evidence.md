# DevNet evidence

What was actually run against the HackCanton shared DevNet participant (NODERS). Fill a section **only from a real run**, with the date, who ran it, the exact command and its non-secret output. Never paste a password, a token or `.env.devnet` contents (other than the ledger user id). `EVIDENCE.devnet` in `packages/domain/src/evidence.ts` stays `run: false` until section 3 has a committed transaction.

Status: **code ready; not yet run on DevNet** (no credential used, nothing uploaded, allocated or submitted).

## 1. Public checks without credentials (run 2026-10-04, by the builder)

`node scripts/devnet/preflight.mjs` from the repository root, no `.env.devnet`, 2026-10-04T14:16:38Z:

```
DevNet preflight: https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services
  ok    node                                 Node 24.16.0 (needs >=24.15 <25)
  ok    GET /readyz                          HTTP 200 [+] ledger ok (SERVING) readyz check passed
  ok    GET /livez                           HTTP 200
  ok    GET /v2/version                      Canton 3.5.19 (expected 3.5.19)
  ok    OpenAPI vs committed spec            sha256 3f62d28ec078a2c0… = committed canton-3.5.19.yaml 3f62d28ec078a2c0…
  ok    OIDC discovery                       issuer, token endpoint, JWKS, password + refresh_token grants, daml_ledger_api + offline_access scopes
  ok    OIDC JWKS                            1 signing key(s): RS256
  skip  credentialed checks                  no DATABASE_URL or DEVNET_LEDGER_USER_ID in .env.devnet (run login.mjs first)
exit=0
```

Also observed (unauthenticated GETs): the OIDC discovery document lists `issuer` `https://keycloak.naas.noders.services/realms/noders-appsfactory`, the token endpoint `…/protocol/openid-connect/token`, the JWKS `…/protocol/openid-connect/certs`, grant types including `password` and `refresh_token`, and scopes including `daml_ledger_api`, `offline_access` and `audience-mapper-hackcanton-01-devnet`. The participant's `/docs/openapi` SHA-256 is `3f62d28ec078a2c0c51cd06b4d96d4bafc83d228e74cadcf2b2ac67b85b13cf0`, equal to `packages/canton/openapi/canton-3.5.19.yaml`.

## 2. Owner steps (to be filled by the owner's run)

| Step | Date | Result (non-secret) |
|---|---|---|
| (a) Wallet onboarding, primary party | | |
| (b) Parties created, quota seen, rights granted automatically? | | |
| (c) DAR uploads (both), vetting | | |
| (d) `db-setup.mjs` | | |
| (e) `login.mjs`: ledger user id, access-token expiry | | |
| (f1) `preflight.mjs` with credentials | | |
| (f2) `import-bindings.mjs`: namespace, 11 parties | | |
| (f3) `bootstrap.mjs`: steps committed | | |

## 3. First committed transaction

| Field | Value |
|---|---|
| Date / run by | |
| Namespace | |
| First command (operation) | |
| updateId | |
| offset | |
| AssetRegistry contract id | |
| CollaraConfig contract id | |
| Seen in the Console | |

## 4. Optional

- `DEVNET_IT=1 pnpm --filter @collara/api test:devnet` (read-only): not run.
- API, worker and web in `COLLARA_MODE=DEVNET`: not run.
