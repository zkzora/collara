# Vendored Decentralization Manager DARs

Copied unchanged from DLC-link `decentralization-manager` **v1.12.0** (tag commit
`4d650edbbf851852311a4921af8f5df608450a6b`), directory `releases/v1/`. The DARs are byte-identical at that tag
and at `main` `63a7898a…` (see `docs/_research/research-dm.md` §1). Licensed Apache-2.0; `LICENSE` and `NOTICE`
are copied from the same source.

| DAR | Main package id | Built with | Used by |
|---|---|---|---|
| `governance-action-v1-0.1.0.dar` | `48acd500fc0bc9e4f00d52270122a104a68157f6d5561328f059f5eb6a63fd61` | SDK 3.4.11, LF 2.2 | `collara-governance` (data-dependency: `GovernableAction` interface) |
| `governance-core-v1-0.1.0.dar` | `361d1f2857f833f8094caf86ecdd5daaa3e2075c22dafe2bf18cde63ee98d488` | SDK 3.4.11, LF 2.2 | `collara-scripts`, `collara-tests` (`GovernanceRules`); uploaded to the ledger for governance |

Verify before use (Git Bash or WSL):

```bash
cd daml/collara/vendor-dars && sha256sum -c SHA256SUMS
```
