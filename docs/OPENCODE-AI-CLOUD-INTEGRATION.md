# OpenCode AI Provider — Cloud Integration Plan

**Nothing is installed on your PC.** No provider call has been made, no model has been fabricated, and no verification has
been simulated. This plan describes the integration that already exists in code and exactly what it needs in order to run.

OpenCode AI stays **PENDING** until you approve a deployment.

---

## 1. What already exists (audited)

| Area | Reality in the repo |
|---|---|
| Integration boundary | `packages/server/src/lib/opencode.ts` is the **only** module that knows how to reach OpenCode (RULE 21.1.6), so the whole product can be repointed at another execution layer without touching a feature (RULE 21.1.15) |
| Mechanism | `child_process.spawn` of the real `opencode` executable |
| Binary resolution | `OPENCODE_BIN` → `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe` → npm shim directory → `PATH` |
| Environment hygiene | A strict child-process env allow-list; `OPENCODE_DISABLE_AUTOUPDATE` and `OPENCODE_DISABLE_TELEMETRY` passed through |
| Timeouts | Models 120s, runs 180s, verification 240s (all bounded, none unbounded) |
| Caching | Model catalogue cached 60s to avoid hammering the CLI |
| Honesty guarantees | Provider list, model list, availability and verification results come **only** from the real executable's output. There is no fallback list, no seeded catalogue, and no fabricated success (RULE 21.1.7, 21.1.8) |
| Company scoping | Per-company AI configuration, keys encrypted at rest and bound to the company as AAD (`company-ai/config-service.ts`, `lib/ai-secret-vault.ts`); a ciphertext minted for one company cannot be decrypted as another |
| Read-only law | The AI surface reads company data; it never writes. |

## 2. What it must do (Part 21 obligations, RULE 16.2.3A)

The final audit must explicitly verify, against a **real** provider:

1. **Company-scoped configuration** — each company configures its own provider/key/model; one company never sees another's.
2. **Real provider/model discovery** — the catalogue comes from the live CLI, not a stored list.
3. **Real verification** — a verification call actually executes; a wrong key reports the real failure reason.
4. **Real execution** — an answer is actually produced by the named provider and model.
5. **Concurrent company operations** — two companies using the same provider simultaneously do not interfere.
6. **Virtual-account concurrency** — unrelated to AI but audited in the same pass.
7. **Failure isolation** — one company's provider failure does not degrade another's.
8. **Cross-company isolation** — a company cannot address another's AI configuration or run against its key.

None of these can be honestly marked complete until the CLI is available.

## 3. Recommended hosting

| Element | Recommendation |
|---|---|
| Where the CLI runs | **Beside the API**, not as a separate service. The integration is `spawn`, so co-locating removes a network hop and keeps the "only place that knows" boundary honest. |
| Container | Bake the CLI into the API image (`npm i -g opencode-ai`), then set `OPENCODE_BIN` to its absolute path so resolution is deterministic rather than PATH-dependent. |
| Credentials | Company AI keys are entered per company in the UI and stored encrypted; the platform default key is entered by the owner. Keys are never returned by an API and never logged. |
| Outbound network | The container needs egress to the AI provider's API. Nothing inbound is required for AI. |
| Hardening | Run the child with the env allow-list already implemented; keep autoupdate and telemetry disabled so an image is reproducible. |

## 4. What you must provide

| Item | Why |
|---|---|
| Approval to install the OpenCode CLI in a deployment image | Without the executable there is no discovery, no verification and no execution |
| A platform AI provider key (owner's default) | Lets the platform demonstrate discovery before any company configures its own |
| Each company's own provider key, entered by that company's admin | Company-scoped configuration; encrypted at rest; never leaves the company |
| A decision on the free tier | The platform treats OpenCode's own provider as the free catalogue; confirm this matches your commercial intent |

## 5. Deployment sequence

1. Build the API image with the OpenCode CLI installed.
2. Set `OPENCODE_BIN` to the absolute CLI path.
3. Set `OPENCODE_DISABLE_AUTOUPDATE=1` and `OPENCODE_DISABLE_TELEMETRY=1`.
4. Start the API; confirm `opencode --version` is reachable inside the container.
5. The owner (or a company admin) configures a provider: pick provider → pick model → **verify** → activate.
6. Only a verified configuration can be activated — an unverified one is not usable, mirroring the provider-secret law.

## 6. What is blocked until you approve

- All of Part 21's runtime obligations (discovery, verification, execution, concurrency, failure and cross-company
  isolation).
- Any UI that would display a live model list: without the CLI it shows an honest unavailable state, not a fake catalogue.

## 7. What is explicitly **not** claimed

- No AI feature is marked working.
- No provider or model list is hard-coded to look real.
- No "verification succeeded" path exists that does not actually execute.

This is the same standard applied to every other pending integration: honest absence, named remaining work.