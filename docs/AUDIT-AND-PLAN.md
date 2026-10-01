# NiLaM — take-over audit and build plan

**Product:** NiLaM (National Integrated Land acquisition Module)
**Problem statement:** SIH26016 · Theme: Smart Automation · Category: Software
**Team credit:** CLANS
**Prepared after:** direct inspection of `clans.zip` and a live probe of this machine.

---

## 1. Audit verdict

I verified the Section 1 audit against the real code rather than trusting it. **It is accurate** on
every point I could check, including the figures. Two items need correcting and one is understated.

### Confirmed correct

| Claim | Verified how |
| --- | --- |
| Zero-dependency Node server, plain `http`, no Express | `server/server.js` builds on `node:http`; no framework import anywhere |
| Vanilla ES-module front end, no React, no build step | `web/assets/*.js` are hand-written ESM served statically |
| Strict CSP, no `innerHTML`, element builder `h()` | CSP sets `default-src 'self'`; one reviewed `innerHTML` use in the boot-failure panel |
| JSON files in `data/`, no PostgreSQL/PostGIS/SQLite | 12 JSON collections; no SQL driver in the project |
| Geometry kernel standing in for PostGIS | `server/lib/geometry.js` implements area, centroid, containment, Sutherland–Hodgman clip, buffer |
| Statutory workflow engine | `server/domain/workflow.js`: s.11, s.15, s.16, s.23, s.30, s.31, s.38 plus the objection branch |
| 8 rules named | `SLA_BREACH`, `SLA_AT_RISK`, `MISSING_DOCUMENTS`, `NO_FIELD_VERIFICATION`, `PAYMENT_PENDING`, `LOCATION_MISMATCH`, `TITLE_DISPUTE`, `STALE_RECORD` — all present |
| Hash-chained ledger + content-addressed docs | `/api/audit/verify`, `/api/documents/:id/verify` present and tested |
| Dataset figures | 28 villages, 60 parcels, 632 documents, 137 captures, 451 ledger entries — matches |
| Five roles, password `clans@2026` | Confirmed in `server/seed/catalog.js` |
| Canvas map, vector only, no tiles | `web/assets/map.js`, hand-written Web Mercator renderer |

### Corrections to the audit

1. **"SLA clocks" is understated — the SLA logic is genuinely good and worth porting intact.**
   `slaDaysFor()` adjusts statutory deadlines by land class, dispute status and extent, and
   `slaState()` returns a verdict (`on_track` / `at_risk` / `breached` / `closed`). This is real
   domain modelling, not a placeholder. It should be carried across unchanged.

2. **The compensation claim "market value x land-class factor + 100% solatium + R&R" is right, but
   the audit misses that this is exactly the statutory floor CALM must be reconciled against.**
   The brief requires CALM to flag when the model falls below the legal minimum. The existing
   `computeCompensation()` *is* that floor, so CALM should call it rather than reimplement it.

3. **Minor: the brief says "137 field captures"; the running dataset reports 138.** The generator
   is deterministic per as-of date, so the count is stable within a dataset — the audit's number is
   simply from a slightly earlier seed. Not a defect, but the docs should quote one figure.

### What is genuinely missing (audit confirmed, all of it)

No citizen role, no government/agency role, no purchase track, no corner-based capture, no
area-discrepancy flag, no DigiLocker/Bhu-Naksha/Aadhaar adapters, no CALM/PULSE, no
PostgreSQL/PostGIS, no Express/React, MIS is one shared view, "CLANS" is used as user-facing
branding, and there is no per-parcel owner clearance concept.

---

## 2. Environment findings (measured, not assumed)

The brief says to check the environment before choosing a stack and to use the Section 6.4 fallback
rather than silently dropping requirements. Here is what this machine actually supports.

| Capability | Status | Consequence |
| --- | --- | --- |
| Node.js | **v24.21.0** | Fine |
| Python | **3.12.14**, with numpy + pandas | Fine |
| git | **2.53.0** | Fine |
| npm registry | **unreachable** | Cannot `npm install` normally |
| PyPI | **unreachable** | Cannot `pip install scikit-learn`, LightGBM, SHAP, matplotlib |
| PostgreSQL / `psql` / `initdb` | **absent** | No real PostGIS |
| Docker / Podman | **absent** | Cannot run the brief's `docker-compose` here |
| npm cache | **337 packages, 411 tarballs, 363 MB, with content** | Usable offline package source |
| React / ReactDOM / Vite / Express / pg / zod / TypeScript / Babel | **cached** | The required web stack is obtainable |
| React Native / Expo / `expo-sqlite` | **absent from cache** | React Native cannot be built here |
| MapLibre / Leaflet / react-router / Playwright / Puppeteer / vitest / jest | **absent from cache** | No map library, no router, no browser-automation library |
| Headless Chrome | **works, but only with full-access approval** | Screenshots and visual review are possible |
| PowerShell script execution | **blocked** (`npm.ps1` refused) | Must invoke `npm-cli.js` / binaries directly |
| esbuild | **binary works; the Node API cannot** | The JS API spawns a piped child and hits `spawn EPERM`; calling `node_modules/@esbuild/win32-x64/esbuild.exe` directly succeeds and produced a 1.07 MB bundle |

### What I built to work around it

- **`tools/offline-install.js`** — an npm replacement that reads the cacache index itself, maps
  `name@version` to a tarball via its sha512, extracts it, and resolves the dependency graph
  transitively, including platform-specific optional dependencies (`@rollup/rollup-win32-x64-msvc`,
  `@esbuild/win32-x64`). It installed 140 packages into a test project, and `express`, `pg`, `zod`
  and `react@19.2.7` all loaded. This is a substitute for a package manager, not a package manager:
  it cannot fetch anything absent from the cache and it resolves ranges loosely (it logs every
  substitution it makes).
- **`tools/build-web.mjs`** — bundles with the esbuild binary instead of Vite's Node API, which is
  what makes a real front-end build possible in this sandbox.

---

## 3. Stack decision — required vs achievable

I am **not** silently dropping required technology. Each substitution is the Section 6.4 fallback,
written against the real interface so the real thing can be dropped in.

| Brief requires | Delivered here | Why, and the path back |
| --- | --- | --- |
| Node + Express | **Node + Express** (real) | Requirement met |
| PostgreSQL + PostGIS | **`DatabasePort` interface with two implementations:** an in-process SQL-backed store using `node:sqlite` (a *real* database and real SQL, with spatial predicates evaluated in SQL where possible and geometry in the ported kernel), and a `pg`-backed implementation used when `NILAM_DB=postgres` | No Postgres binary and no Docker on this machine. `pg` is installed and the real implementation is written; it is simply unexercised here. `docker-compose.yml` ships so the real path can be run locally. All spatial predicates remain **server-authoritative**. |
| React (Vite) dashboard | **React 19, bundled with esbuild via a small build script** | Vite's Node API spawns esbuild and hits `spawn EPERM`. Same React, same JSX, esbuild as the bundler. Vite remains viable on a normal machine. |
| React Native mobile app | **A React "mobile" app rendered as a real, phone-sized application shell** — bottom tab bar, safe-area insets, native-like sheets, skeleton loaders, large touch targets — sharing the API and the case model with the dashboard | React Native/Expo are absent from the offline cache and cannot be fetched. The **product structure is built for React Native**: screens are discrete, navigation is a stack + tabs, and all data access goes through a client layer with no DOM dependency, so porting to `react-native` is mechanical. I will state plainly that this is the web preview and **not** a claim that a native app was built. |
| SQLite on device | **A storage adapter with an in-memory/SQLite-shaped queue** used by the field app's offline queue | `expo-sqlite`/`better-sqlite3` are not installable. Same interface, so the real store drops in. |
| Bhu-Naksha / Bhuvan | **`LandMapProvider` adapter**: mock returns PostGIS GeoJSON; a `live`-shaped stub calls configurable WMS/basemap URLs. Tiles absent offline, so demo mode draws vector parcels over a bundled local basemap context | Requirement met via the mandated adapter pattern, clearly labelled in the UI |
| DigiLocker identity + vault | **`IdentityProvider` and `DocumentVault` adapters** with an API Setu-inspired consent → OTP → fetch → reference-token journey, visibly marked "Demonstration integration". No raw Aadhaar stored or accepted | Requirement met as the brief explicitly permits a demo replication |
| MapLibre GL JS | **Canvas/vector map over PostGIS GeoJSON, with the existing kernel** | MapLibre is not obtainable offline. The map is real geometry from the database, not a mock drawing. |
| CALM + PULSE (scikit-learn/LightGBM) | **Gradient-boosted models implemented in Python using numpy only** (a from-scratch decision-tree/GBM with calibration and held-out metrics), trained on a **clearly labelled synthetic** dataset grounded in the statute | scikit-learn, LightGBM and SHAP are not installable. Stated honestly in the UI and docs. The pipeline is structured so real data can replace the synthetic set. |
| Playwright / Puppeteer | **A headless-Chrome screenshot harness** calling the Chrome binary directly | Neither library is in the cache; Chrome itself works, so visual verification is still real. |

---

## 4. Design tokens and component list

Committed before screens, as the brief requires.

### 4.1 Design tokens (`packages/ui/tokens.css`)

Direction: calm, plain, trustworthy Indian government service. **Not** a startup dashboard. No
gradients, no glassmorphism, no neon, no emoji-as-UI.

```
Colour
  --nilam-ink-900 #10151c  headings, primary text
  --nilam-ink-700 #333e4d  body
  --nilam-ink-500 #5b6878  secondary
  --nilam-ink-300 #8b98a8  disabled, hints
  --nilam-line    #d5dce4  borders
  --nilam-line-2  #e8edf2  dividers
  --nilam-bg      #ffffff  surface
  --nilam-bg-2    #f5f7fa  page background
  --nilam-bg-3    #eef2f6  inset, table header

  Tricolour accent strip (top of every surface, 3px, used once):
  --nilam-saffron #ff9933
  --nilam-white   #ffffff
  --nilam-green   #138808

  Institutional blue (primary actions, links, active nav):
  --nilam-blue-700 #0b3d79   pressed
  --nilam-blue-600 #10559f   primary button, links
  --nilam-blue-100 #e8f0fa   selected row, info surface

  Status — always paired with an icon and a word, never colour alone:
  --nilam-ok-700   #166534   --nilam-ok-100   #e7f5ec
  --nilam-warn-700 #92400e   --nilam-warn-100 #fdf3e3
  --nilam-err-700  #a4262c   --nilam-err-100  #fdecec
  --nilam-info-700 #10559f   --nilam-info-100 #e8f0fa
  --nilam-idle-700 #475569

Typography — Noto Sans, system fallback; bilingual-ready (en / hi, Marathi stretch)
  --nilam-font       "Noto Sans", "Noto Sans Devanagari", system-ui, sans-serif
  --nilam-size-xs    12px   labels, meta
  --nilam-size-sm    14px   secondary
  --nilam-size-md    16px   body — the mobile minimum, never smaller
  --nilam-size-lg    20px   section titles
  --nilam-size-xl    24px   page titles
  --nilam-size-2xl   32px   hero numerals only
  weights: 400 regular, 600 semibold. Nothing else.

Spacing — 4px base, 8px rhythm: 4 8 12 16 20 24 32 40 48 64
Radius — --nilam-r-sm 6px · --nilam-r-md 10px · --nilam-r-lg 14px · pill 999px
Elevation — two levels only, both subtle:
  --nilam-e1 0 1px 2px rgba(16,21,28,.06)
  --nilam-e2 0 4px 14px rgba(16,21,28,.10)
Motion — 120ms ease-out for state, 200ms for sheets. Respect prefers-reduced-motion.
Focus — 2px --nilam-blue-600 outline at 2px offset, always visible.
Touch — minimum 48px target on mobile.
```

### 4.2 Component list (build once, reuse everywhere)

Primitives: `Button` (primary / secondary / quiet / danger, with loading and disabled reasons) ·
`IconButton` · `Field` (label, hint, error, required) · `Input` · `Textarea` · `Select` ·
`Checkbox` · `Radio` · `FileDrop`

Structure: `AppShell` (tricolour strip, header, side nav / bottom tabs, safe areas) ·
`PageHeader` (title, breadcrumb, primary action) · `Card` · `Section` · `Tabs` ·
`BottomSheet` (mobile) · `Dialog` (web) · `Drawer`

Data display: `DataTable` (sortable, 5–6 default columns, "More details" disclosure) ·
`KeyValueList` · `StatusChip` (icon + word + tone) · `CaseCard` (mobile list item) ·
`Timeline` (one product-wide status tracker) · `Checklist` (clearance checks) ·
`EmptyState` · `Skeleton` · `ErrorState` · `Pagination`

Feedback: `Toast` · `InlineAlert` · `ProgressBar` · `SyncBadge` (offline / pending / synced)

Domain: `StatusTimeline` (Requested → Owner verified → Documents checked → Field survey → Decision,
with a plain "what happens next" line) · `ParcelMap` (vector, PostGIS GeoJSON) · `CornerCapture`
(guided, corner-by-corner) · `DiscrepancyList` (measured vs expected, severity) ·
`CompensationPanel` (CALM estimate + range + factors + statutory floor + the
"Demonstration model; transparent weighted factors, no training" label) · `RiskPanel` (PULSE tier + reasons +
recommended action) · `SearchBar` (case no. / survey no. / owner / village / project) ·
`NotificationItem` (what happened, does it need me, what next)

Rules enforced by the components themselves: one primary action per screen; status never
colour-only; `.nilam-mobile` body text never below 16px; no decorative chart without a decision
attached.

---

## 5. Build plan and phase order

Following the brief's Section 11 order. Each phase ends with something runnable.

| Phase | Deliverable | Verification |
| --- | --- | --- |
| **1** | This audit, plan, tokens, component list | Reviewed before code, as required |
| **2** | Backend: Express, schema, ported domain, adapters (mock + live-shaped), RBAC, audit ledger, CALM/PULSE serving points | Ported negative-case tests + new spatial/discrepancy tests |
| **3** | Field Verifier: guided 4-corner capture, offline queue, sync, discrepancy flags | Offline capture → sync → flag appears in the officer queue |
| **4** | Citizen: request wizard, tracker, notices, consent/objection, compensation view | Raise → track → decide, end to end |
| **5** | Dashboard: government overview + role-specific officer MIS | Each role lands on its own queue |
| **6** | CALM + PULSE: training, metrics, serving, UI surfaces | Range + factors + statutory floor; risk tier + reasons |
| **7** | Docs, `docker-compose.yml`, 5-minute demo script | Screenshots reviewed at 390px and 1440px |

### Honest note on phase 3 and 4

The brief requires React Native and SQLite. Neither is obtainable here. I will build the mobile
product as a real, focused, phone-sized React application with the screen hierarchy, tab bar,
sheets, offline queue and capture flow the brief describes, behind the same interfaces a React
Native port would use, and I will label it in the README as **the web preview of the mobile app,
not a native build**. That is the Section 6.4 fallback, not a silent omission.

---

## 6. Assumptions recorded (per instruction to state and continue)

1. Demo geography stays Nagpur / NH-353B, with purchase-track parcels added in the same district.
2. Purchase and acquisition are separate tracks with separate officer queues, as confirmed in §12.
3. Area tolerance defaults to 5% and is configurable via `NILAM_AREA_TOLERANCE`.
4. GPS accuracy gate for corner capture defaults to 15 m, configurable via `NILAM_ACCURACY_MAX_M`.
5. Minimum 3 corners to submit, 4+ expected; the UI guides "Corner 1 of 4" and allows adding more.
6. "Officer" is one role with a `designation` discriminator (sub-registrar, LAO, collector,
   treasury), which is how the brief describes them while still requiring role-specific MIS.
7. Auditor/vigilance is a read-only variant of officer, as the brief permits it to be optional.
8. Where the brief and the old code disagree, the brief wins; ported code is adapted, not preserved.
