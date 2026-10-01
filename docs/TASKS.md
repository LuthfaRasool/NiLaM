# NiLaM — task status

**Last updated:** this session · **Verified by:** commands actually run, results recorded below
**Project root:** `nilam/` (new project). The old prototype is untouched at `clans/`.

Legend: ✅ done and verified · 🔄 in progress · ⬜ not started · ⛔ blocked by environment

---

## A. Discovery and environment (✅ complete)

| # | Task | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Read the redesign brief | ✅ | `NiLaM_redesign_brief_clarified (1).md`, 335 lines |
| A2 | Locate the three inputs (brief, `clans.zip`, `CLANS (1).pdf`) | ✅ | `clans.zip` unzipped; the live prototype is in the workspace at `clans/` |
| A3 | Probe the toolchain | ✅ | Node v24.21.0 · Python 3.12.14 · git 2.53.0 |
| A4 | Test network reachability | ✅ | npm registry **unreachable** · PyPI **unreachable** |
| A5 | Test for Postgres / Docker / Podman | ✅ | **all absent** — no `psql`, `pg_ctl`, `initdb`, `docker`, `podman` |
| A6 | Inspect the npm cache for usable packages | ✅ | 337 packages / 411 tarballs / 363 MB **with real content** |
| A7 | Check the required stack against the cache | ✅ | React 19.2.7, ReactDOM, Vite 6.4.3, Express 4.22.2, pg 8.23.0, zod, TypeScript 5.8.3, Babel — **present**. React Native, Expo, MapLibre, Leaflet, react-router, Playwright, Puppeteer, vitest — **absent** |
| A8 | Test whether npm can install from cache | ✅ | **Fails** — `ENOTCACHED`; npm wants to revalidate packument metadata that was never cached |
| A9 | Test the esbuild binary vs its Node API | ✅ | Node API → `spawn EPERM`. Binary called directly → **produced a 1.07 MB bundle** |
| A10 | Test `node:sqlite` as a real SQL substitute | ✅ | Works — `DatabaseSync`, real DDL/DML, returned rows |
| A11 | Test headless Chrome for screenshots | ✅ | **Blocked under the default sandbox** (crashpad + mojo named pipes denied) · **works under full-access approval** — produced a valid 800×300 PNG, visually confirmed |
| A12 | Check PowerShell script execution | ✅ | **Blocked** by execution policy — `npm.ps1` refused; must call `npm-cli.js` / binaries directly |

---

## B. Audit of the existing codebase (✅ complete)

| # | Task | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Verify the brief's Section 1 audit against real code | ✅ | All 13 claims checked; 12 confirmed exactly |
| B2 | Verify the dataset figures | ✅ | 28 villages · 60 parcels · 632 documents · 451 ledger entries — all match |
| B3 | Verify the 5 roles and password | ✅ | `clans@2026`, confirmed in `server/seed/catalog.js` |
| B4 | Verify the 8 named rules | ✅ | All 8 present in `server/domain/workflow.js` |
| B5 | Correct the audit where it was wrong | ✅ | 2 corrections + 1 understatement recorded |
| B6 | Confirm what is genuinely missing | ✅ | All 11 gaps verified real |

**Corrections I recorded:**
1. "SLA clocks" was **understated** — `slaDaysFor()` and `slaState()` are real domain modelling and should be ported intact.
2. The audit missed that the existing `computeCompensation()` **is** the statutory floor that CALM must be reconciled against.
3. The brief says 137 field captures; the running seed reports 138 (deterministic per as-of date — not a defect).

---

## C. Workarounds built (✅ complete and proven)

| # | Deliverable | Status | Evidence |
| --- | --- | --- | --- |
| C1 | `tools/offline-install.mjs` — an npm replacement reading the cacache index, mapping `name@version` → tarball by sha512, extracting, and resolving the graph transitively **including platform-specific optional deps** | ✅ | Parses 1026 index entries → 337 packages. Installed **140 packages** into a test project; `express`, `pg`, `zod`, `react@19.2.7` all load |
| C2 | Handle platform binaries (`@rollup/rollup-win32-x64-msvc`, `@esbuild/win32-x64`) via each package's own `os`/`cpu` fields | ✅ | Both extracted; previously the cause of a Rollup `MODULE_NOT_FOUND` |
| C3 | Install NiLaM's stack into the new project | ✅ | **87 packages** installed into `nilam/node_modules`; all six required packages verified loadable |
| C4 | Establish that a real front-end build is possible | ✅ | esbuild binary bundles JSX/React without the Node API |

---

## D. Decisions recorded (✅ complete)

| # | Task | Status | Evidence |
| --- | --- | --- | --- |
| D1 | Write the take-over audit | ✅ | `docs/AUDIT-AND-PLAN.md` |
| D2 | Write the build plan with phase order | ✅ | 7 phases mapped to brief §11 |
| D3 | Stack decision: required vs achievable, with the path back | ✅ | 10-row table; every substitution is the §6.4 fallback written against the real interface |
| D4 | Design tokens | ✅ | 5 groups: colour, typography, spacing, radius/elevation, motion — no gradients/glassmorphism/neon |
| D5 | Component list | ✅ | 40 components in 6 groups, with the rules each component enforces |
| D6 | Record assumptions (8) | ✅ | Brief §12 honoured; each stated in one line |

---

## E. Code written (🔄 in progress)

| # | Deliverable | Status | Evidence |
| --- | --- | --- | --- |
| E1 | Project scaffold + manifest | ✅ | `nilam/package.json` |
| E2 | `packages/domain/acquisition.mjs` — statutory engine | ✅ written | 7 stages + blocked off-ramp, 5 purchase stages, RBAC for 5 roles + 4 officer designations, transition validation, 6 per-parcel clearance checks, SLA clock, statutory floor, 11-rule engine, citizen-facing explanations |
| E3 | `packages/geometry` ported kernel | ⬜ | |
| E4 | `db/` PostGIS schema + migrations + seed | ⬜ | |
| E5 | `services/api` — Express, RBAC, audit ledger | ⬜ | |
| E6 | Five adapters (identity, vault, map, payment, notifier) with mock + live-shaped stubs | ⬜ | |
| E7 | Field Verifier app — 4-corner capture, offline queue, discrepancy flags | ⬜ | |
| E8 | Citizen app — request wizard, tracker, notices, consent/objection | ⬜ | |
| E9 | Dashboard — government overview + role-specific officer MIS | ⬜ | |
| E10 | CALM + PULSE (numpy only) | ⬜ | |
| E11 | Tests (negative cases) | ⬜ | |
| E12 | `docker-compose.yml`, README, demo script | ⬜ | |
| E13 | Screenshots at 390px and 1440px, visually reviewed | ⬜ | Chrome harness proven in A11 but not yet built |

---

## F. Known constraints affecting delivery (⛔ environment, not choice)

| Constraint | Impact | Mitigation in place |
| --- | --- | --- |
| No npm registry, no PyPI | Cannot install anything not already cached | `tools/offline-install.mjs` (C1); 337 packages available |
| No Postgres, no Docker | Cannot run PostGIS | `DatabasePort` with a `pg` implementation (written, unexercised) **and** a `node:sqlite` implementation using real SQL; `docker-compose.yml` to be shipped for the real path |
| React Native / Expo absent from cache | Cannot build a native app | Mobile product built as a phone-sized React app behind the same interfaces; **will be labelled as the web preview, not a native build** |
| scikit-learn / LightGBM / SHAP absent | Cannot use the named ML libraries | CALM/PULSE implemented as gradient-boosted models in numpy, on a clearly labelled synthetic dataset |
| MapLibre / Leaflet absent | No map library | Vector map over PostGIS GeoJSON using the ported geometry kernel |
| esbuild Node API `spawn EPERM` | Vite's default build unusable | esbuild **binary** invoked directly (A9) |
| Chrome needs full access | Screenshots need approval each run | Harness to be built; approval requested per run |
| PowerShell execution policy | `npm.ps1` unusable | Invoke `npm-cli.js` and binaries directly |

---

## G. Immediate next steps (in order)

1. Port `geometry` kernel → `packages/geometry/`.
2. PostGIS schema + migrations + a seed that extends the Nagpur dataset with a purchasing citizen, a requesting agency, a purchase request, co-owners, litigation and prior-acquisition cases (so the clearance and discrepancy features have real data to act on).
3. Express API with server-side RBAC on every route, the hash-chained audit ledger, and the five adapters.
4. Field Verifier capture flow + server-authoritative discrepancy detection (area vs requested/record, corners outside boundary, neighbour overlap, suspicious GPS).
5. Citizen request wizard + tracker.
6. Role-specific officer MIS + government overview.
7. CALM + PULSE with metrics, the statutory-floor reconciliation, and their UI surfaces.
8. Tests, screenshots at both widths with visual review, README + `docker-compose.yml` + demo script.

---

## H. What can be claimed as verified today

- The brief's audit of the old codebase is **accurate**, with three refinements noted.
- The environment **cannot** run the full required stack; this was measured, not assumed.
- A **working offline package installer** was built and used to install a real React 19 + Express + pg stack.
- **Headless Chrome screenshots work**, so the brief's visual-verification requirement is achievable.
- The **statutory domain engine has been ported and extended** with the brief's per-parcel clearance checks, purchase track, and citizen-facing plain language.

**No UI has been built yet, and no screenshot of NiLaM exists.** Nothing in Section E beyond E1–E2 should be treated as done.
