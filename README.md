# NiLaM — National Integrated Land acquisition Module

**SIH26016 · Theme: Smart Automation · Team CLANS**

NiLaM unifies the two halves of land management that today live in separate,
paper-driven silos: **compulsory acquisition** under the RFCTLARR Act 2013, and
**private land purchase**. One citizen-facing tracker, one officer workspace, one
server-side source of truth, and one append-only audit ledger.

> **Honesty note, first.** This is a working prototype built in a fully offline
> sandbox with no package registry, no PostgreSQL binary, no Docker, no React
> Native toolchain and no installable ML libraries. Everything the brief called a
> government integration (DigiLocker, Bhu-Naksha/Bhuvan, PFMS, SMS) is built
> behind an adapter interface with a clearly labelled demonstration
> implementation. CALM and PULSE are transparent weighted-factor models, **not**
> trained models, and the UI says so. Nothing in this repository claims to be
> connected to a live government service.

---

## What is real vs what is demonstrated

| Component | Status |
| --- | --- |
| Statutory workflow (s.11 → s.15 → s.16 → s.23 → s.30 → s.31 → s.38, plus the objection branch) | **Real** — server-side validation of stage edges, role authority, document prerequisites, and a ground-truth gate that blocks an award without an accepted corner-based field verification |
| Per-parcel clearance checks (litigation, title dispute, co-owners, encumbrance, prior acquisition, ROR) | **Real** — evaluated per case and surfaced as a plain checklist |
| SLA clock | **Real** — statutory days adjusted by land class and dispute, verdicts `on_track` / `at_risk` / `breached` |
| Compensation floor | **Real** — market value × land-class factor + 100% solatium + R&R |
| Discrepancy engine (area mismatch, corners outside boundary, neighbour overlap, suspicious GPS) | **Real** — recomputed server-side from coordinates; a client's numbers are never trusted |
| Audit ledger | **Real** — SHA-256 hash chain; `/api/audit/verify` re-walks it and detects tampering |
| Document vault | **Real** — content-addressed revisions; `/api/documents/:id/verify` re-hashes every revision |
| Database | **Real SQL**, on a substitute engine: `node:sqlite` when no Postgres exists, PostgreSQL/PostGIS when `NILAM_DB=postgres` (schema and spatial expressions are defined for both) |
| React dashboard + mobile app | **Real React 19**, bundled with esbuild |
| DigiLocker, Bhu-Naksha, Bhuvan, PFMS, SMS | **Demonstration adapters** — mock + live-shaped stub, selected by `NILAM_MODE=demo|live` |
| CALM (compensation estimate) | **Demonstration** — weighted factors with an itemised breakdown, reconciled against the statutory floor |
| PULSE (delay/litigation risk) | **Demonstration** — fixed signal weights mapped to a probability, with reasons and a recommended action |

---

## Run it

The package manager and the bundler both have to work around this sandbox, so the
commands are explicit.

```powershell
# 1. Install dependencies from the local npm cache (no network needed).
node tools/offline-install.mjs install .

# 2. Build the database and seed the Nagpur demonstration dataset.
node db/migrate.mjs --reset
node db/seed.mjs

# 3. (Optional) Build the CALM/PULSE artefact.
python services/ml/build_models.py

# 4. Build the web application.
node tools/build-web.mjs

# 5. Run the API and the dashboard on one port.
$env:NILAM_PORT = "4180"
node services/api/server.mjs
```

Open **http://127.0.0.1:4180**.

### Demonstration accounts

Password for every account: **`nilam@2026`**

| Username | Role | What you see |
| --- | --- | --- |
| `lao` | Land Acquisition Officer | Acquisition queue, case workspace, transitions |
| `registrar` | Sub-Registrar | Purchase-track scrutiny queue |
| `collector` | Collector | Approvals, disputes, at-risk cases |
| `treasury` | Treasury Officer | Payments due and failed |
| `nhai` | Government / NHAI | Project progress and projected delays |
| `ramesh` / `sunita` / `vithal` | Citizens | Own cases, tracker, consent/objection |
| `surveyor1` / `surveyor2` | Field verifiers | Assignments |
| `auditor` | Audit & Vigilance | Read-only ledger and cases |

Deep-links work for reviews and the screenshot harness: `/?as=lao`, `/?as=nhai`,
`/?as=ramesh`, `/?as=lao&view=case`.

---

## Verify

```powershell
# Domain, crypto, geometry, ML and RBAC: 28 checks.
node tests/run.mjs

# API level: deny-by-default, cross-owner isolation, illegal transitions, ledger. 12 checks.
node tests/api.mjs

# Visual review at 390px and 1440px (needs Chrome/Edge and full sandbox access).
node tools/screenshots.mjs
```

Screenshots are written to `docs/screenshots/`. The `TASKS.md` and
`AUDIT-AND-PLAN.md` documents record what was built, what was corrected in the
original brief's audit, and the environment findings.

---

## Why the stack looks the way it does

The brief asked to check the environment before choosing a stack and to use the
Section 6.4 fallback rather than silently dropping requirements. These were
**measured**:

- **npm registry and PyPI are unreachable.** `tools/offline-install.mjs` reads the
  machine's npm cache directly and installs React 19, Express, `pg` and `zod`
  without the registry. It is an offline substitute, not a package manager.
- **No PostgreSQL/PostGIS binary and no Docker.** `db/schema.mjs` defines the
  schema for both dialects; the runnable default is `node:sqlite`, which is real
  SQL with constraints and transactions. Set `NILAM_DB=postgres` on a machine
  that has PostGIS, and `docker-compose.yml` ships the deployment shape.
- **No React Native/Expo in the cache.** The mobile product is a phone-sized
  React app sharing the API and case model. It is the web preview of the mobile
  app, **not** a native build — the screen hierarchy, tabs and offline queue are
  structured so a React Native port is mechanical.
- **No scikit-learn / LightGBM / XGBoost / SHAP.** CALM and PULSE are transparent
  weighted-factor models. They are not trained, so none of those libraries is
  needed; claiming accuracy for them would be the dishonest part, and the code
  and UI say so.
- **Vite's build spawns esbuild through piped stdio, which this sandbox refuses**
  (`spawn EPERM`). `tools/build-web.mjs` invokes the esbuild binary directly; the
  React and JSX are real.
- **Chrome cannot start under the confined sandbox.** Visual verification at
  390px and 1440px runs under full access via `tools/screenshots.mjs`, which also
  reports any element overflowing the viewport and the computed size of the map
  canvas — the exact failure that made the previous iteration's map blank.

---

## Deployment shape (for a machine that has PostGIS)

```bash
docker compose up --build
```

`docker-compose.yml` runs the API and the database with `NILAM_DB=postgres` and
PostGIS. `frame-ancestors` and other headers that cannot be delivered via a
`<meta>` element are set by the reverse proxy there, as noted in
`tools/build-web.mjs`.
