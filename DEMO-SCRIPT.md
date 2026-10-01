# NiLaM demo script — a five-minute walkthrough.

This is a script for a judge or reviewer, not a list of features. It hits the
moments where NiLaM is visibly better than the status quo.

## 0. Start (30 seconds)

```
node tools/offline-install.mjs install .
node db/migrate.mjs --reset
node db/seed.mjs
node tools/build-web.mjs
$env:NILAM_PORT = "4180"; node services/api/server.mjs
```

Open http://127.0.0.1:4180. Point out the tricolour strip and the
"Demonstration" badge — every screen carries it, so no integration is ever
mistaken for a live government connection.

## 1. The officer's morning (60 seconds)

Sign in as **`lao`** (`nilam@2026`).

- The queue is ordered **exception-first**: the case with the most unresolved
  issues is at the top. Say the words on the page: "needs your action", "past the
  statutory clock", "blocked by clearance".
- Open the top case. Three things to call out:
  1. The **clearance checklist** — litigation, title dispute, co-owners — each
     with the question asked and the action to take.
  2. The **map** — real stored geometry, with the surveyed boundary drawn dashed
     over it, so a mis-survey is visible at a glance.
  3. The **disabled action with its reason** — "Move to Award" is greyed out and
     says why. Paper doesn't do that.

## 2. CALM and PULSE, honestly (60 seconds)

On the same case, click **"Run CALM & PULSE"**.

- CALM shows an amount with a range and an **itemised breakdown** (market value,
  solatium, R&R, road frontage, trees). It is reconciled against the statutory
  floor: the label says the model is *not* a trained valuation model.
- PULSE shows a risk probability with the **reasons and the points each one
  contributed** — "litigation +26", "ownership disputed +24" — and a recommended
  action. It says "transparent weighted factors, no training".

The point to make: a demonstration model that *explains itself* is more useful to
an officer than a black box.

## 3. The statutory workflow (60 seconds)

- Try to jump a case straight to **Award Approved**. NiLaM refuses (409) and
  names the exact rule broken.
- Move a case through the proper edge with a reason. The ledger entry number
  appears in the confirmation.

## 4. Field verification catches what the paper misses (60 seconds)

Sign in as **`lao`** and open a case with a **"Survey flagged"** chip.

- Show the discrepancy: "surveyed area is N% larger than the record", "a corner
  falls outside the boundary", or "the device reported a mock location".
- The key sentence: **this was computed server-side from the coordinates — the
  field app's own numbers are never trusted.**

## 5. Who sees what (45 seconds)

- Sign in as **`ramesh`** (a citizen). They land on "My land": plain language,
  where the case has reached, what happens next, and *"I agree / I object"*.
- Sign in as **`registrar`**. Their queue is the **purchase track only** — a
  sub-registrar cannot touch an acquisition case.
- Sign in as **`nhai`**. The agency sees project progress, payable vs disbursed,
  and **projected delays** — not case detail.

## 6. The ledger (30 seconds)

Sign in as **`auditor`**. The audit ledger shows every action, and
**"Re-verify"** re-walks the SHA-256 chain. The demo dataset is tamper-free; the
`tests/` suite proves a single altered entry breaks verification at exactly that
index.

---

## If you are asked about the gaps

- **"Is this connected to DigiLocker?"** No. It is a DigiLocker-style consent →
  OTP → verified-profile flow behind an adapter, clearly labelled. Onboarding is
  a government process, not a code change.
- **"Where is PostGIS?"** The schema and spatial expressions are defined for
  PostgreSQL/PostGIS; this machine has no Postgres binary or Docker, so the
  runnable default is `node:sqlite`. `docker-compose.yml` ships the real path.
- **"Is CALM a real ML model?"** No, and it doesn't pretend to be. It is a
  transparent weighted-factor model. That is the honest choice when no ML
  library and no real training data exist.
- **"Where is the native app?"** React Native/Expo cannot be installed offline.
  The mobile product is a phone-sized React app behind the same interfaces; the
  README states this plainly.
