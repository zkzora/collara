# Keycloak realm `collara` (local development)

[`collara-realm.json`](collara-realm.json) is imported by `node scripts/infra/keycloak.mjs start` (native
Keycloak 26.7.5) and by [`infra/compose/compose.yaml`](../compose/compose.yaml) (untested). See
[`docs/setup.md`](../../docs/setup.md) §4 for the commands and what was verified.

**Synthetic, local-only accounts.** Every demo user has the password `collara-demo-only`. Never import
this realm into a shared, hosted or internet-reachable Keycloak.

## Client `collara-web`

| Setting | Value |
|---|---|
| Type | Confidential (`client-secret`); the secret is the `${COLLARA_OIDC_CLIENT_SECRET}` placeholder, substituted at import |
| Flows | Standard flow (Authorization Code) only; implicit, direct access grants, service accounts, device and CIBA are off |
| PKCE | Required, `S256` (`pkce.code.challenge.method`) |
| Redirect URI | `http://localhost:3000/api/auth/callback` |
| Post-logout redirect URI | `http://localhost:3000/` |
| Web origins | none (the token exchange is server-side) |

Realm settings: `accessTokenLifespan` 300 s (the same as Canton's 300 s JWT cap), SSO idle 30 min, SSO max
10 h, self-registration and password reset off, brute-force detection on, `sslRequired: external`
(plain HTTP is accepted from localhost only).

## Demo users

Identity only. Collara's database holds organisation membership, role, mandate and party binding;
Keycloak has no Collara roles (synthesis §1.3.3). The intended mapping is from synthesis §1.3.

| Username (= email) | Display name | Intended Collara identity |
|---|---|---|
| `manufacturer.owner@demo.test` | Demo Manufacturer Owner | Demo Manufacturer: Borrower / Asset Owner |
| `manufacturer.admin@demo.test` | Demo Manufacturer Admin | Demo Manufacturer: Organization Admin |
| `dealer.contributor@demo.test` | Demo CNC Dealer Contributor | Demo CNC Dealer: Dealer Contributor |
| `verifier.inspector@demo.test` | Demo Verifier Inspector | Demo Verifier: Verifier |
| `lender-a.analyst@demo.test` | Dana Reyes | Demo Lender A: Lender Analyst |
| `lender-a.approver@demo.test` | Morgan Hale | Demo Lender A: Lender Approver (also the governance seat-1 mandate) |
| `lender-b.approver@demo.test` | Demo Lender B Approver | Demo Lender B: Lender Approver (seat-2 mandate) |
| `auditor@demo.test` | Demo Auditor Auditor | Demo Auditor: Auditor (seat-3 mandate) |
| `operator@collara.test` | Collara Operator | Collara Operator |

## Changing the realm

Keycloak imports a realm only when it does not exist yet. After editing this file or changing
`COLLARA_OIDC_CLIENT_SECRET`, run `node scripts/infra/keycloak.mjs reset` before the next `start`.
