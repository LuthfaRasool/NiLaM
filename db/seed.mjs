/**
 * NiLaM demonstration seed.
 *
 * Deterministic: the same PRNG seed always produces the same villages, parcels,
 * owners, cases and ledger, so a demo is reproducible and a screenshot taken
 * today still matches tomorrow.
 *
 * Geography is the real Nagpur revenue district of Maharashtra, which is the
 * dataset the previous prototype established. What is new here, and what the
 * brief requires, is the data that makes the *decision* features real:
 *
 *   - multi-owner parcels with legal heirs, so the co-owner clearance check bites
 *   - parcels with active litigation, encumbrances and prior acquisition attempts
 *   - a purchase track with a citizen buyer and a sub-registrar queue
 *   - field captures whose surveyed area deliberately mismatches the record on a
 *     few parcels, so the area-discrepancy flag has something to find
 *   - risk inputs (co-owner count, disputes, objections, missing documents)
 *
 * Usage: node db/seed.mjs
 */

import { db, migrate, closeDb } from './index.mjs';
import { hashPassword, sha256, ledgerHash, GENESIS } from '../packages/crypto/index.mjs';
import {
  STAGES, STAGE_BY_ID, PURCHASE_STAGES, PURCHASE_STAGE_BY_ID,
  LAND_CLASS_FACTORS, statutoryFloor, runClearanceChecks, slaDaysFor
} from '../packages/domain/acquisition.mjs';
import * as G from '../packages/geometry/index.mjs';

const DAY = 86400000;
const SEED = 'nilam-sih26016-nagpur-2026';
const NOW = Date.parse(process.env.NILAM_SEED_AS_OF || '2026-10-01T09:30:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ *
 * Deterministic PRNG (mulberry32 seeded from a string hash)
 * ------------------------------------------------------------------ */

function makeRng(seedString) {
  let a = parseInt(sha256(seedString).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (a, b) => a + rng() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

const DISTRICT = {
  name: 'Nagpur',
  state: 'Maharashtra',
  boundary: [
    [78.968, 21.052], [79.046, 21.148], [79.158, 21.164], [79.284, 21.118],
    [79.322, 21.012], [79.258, 20.906], [79.136, 20.874], [79.028, 20.918], [78.968, 21.052]
  ]
};

const VILLAGE_NAMES = [
  'Kamptee', 'Kanhan', 'Parshivni', 'Koradi', 'Mouda', 'Kuhi',
  'Umred Road', 'Bhiwapur', 'Kalmeshwar', 'Mohpa', 'Saoner', 'Walni'
];

const FIRST_M = ['Ramesh', 'Vithal', 'Prakash', 'Devendra', 'Gajanan', 'Rajendra', 'Sanjay', 'Bhaskar', 'Pralhad', 'Ashok', 'Mohan', 'Sudhir'];
const FIRST_F = ['Sunita', 'Anjali', 'Shobha', 'Manisha', 'Kavita', 'Usha', 'Nanda', 'Vaishali', 'Rekha', 'Lata'];
const LAST = ['Deshmukh', 'Patil', 'Wankhede', 'Gedam', 'Bhende', 'Tandulkar', 'Raut', 'Kalbande', 'Meshram', 'Chaudhari', 'Bhoyar', 'Dongre', 'Khedkar', 'Shende'];

const LAND_USES = {
  agricultural: ['Cotton', 'Soybean', 'Tur', 'Jowar', 'Paddy', 'Sugarcane'],
  homestead: ['Residential'],
  commercial: ['Shop', 'Godown', 'Petrol pump'],
  barren: ['Fallow'],
  waterbody: ['Farm pond'],
  forest: ['Reserved forest']
};

function personName() {
  const female = rng() < 0.35;
  const first = female ? pick(FIRST_F) : pick(FIRST_M);
  return {
    name: `${first} ${pick(LAST)}`,
    guardian: `${female ? 'D/o' : 'S/o'} ${pick(FIRST_M)} ${pick(LAST)}`,
    gender: female ? 'F' : 'M'
  };
}

function docTitle(type, survey) {
  const labels = {
    PRELIMINARY_NOTIFICATION: 'Section 3A Notification',
    NEWSPAPER_PUBLICATION: 'Newspaper Publication Proof',
    OBJECTION_HEARING_MINUTES: 'Section 15 Objection Hearing',
    SURVEY_REPORT: 'Survey & Demarcation Report',
    FIELD_VERIFICATION: 'Geo-tagged Field Verification',
    VALUATION_REPORT: 'Valuation Report',
    DRAFT_AWARD: 'Draft Award Statement',
    TITLE_VERIFICATION: 'Title Verification Note',
    AWARD: 'Award (s.30)',
    BANK_MANDATE: 'Bank Mandate',
    PAYMENT_ADVICE: 'Payment Advice',
    CONSENT_FORM: 'Consent Form',
    POSSESSION_CERTIFICATE: 'Possession Certificate',
    ROR_MUTATION_ENTRY: 'Mutation Entry',
    LITIGATION_REFERENCE: 'LARR Authority Reference',
    OBJECTION_FILED: 'Objection Filed by Owner',
    SALE_DEED_DRAFT: 'Draft Sale Deed',
    ENCUMBRANCE_CERTIFICATE: 'Encumbrance Certificate',
    SELLER_TITLE_DEED: 'Seller Title Deed',
    CONSIDERATION_PROOF: 'Proof of Consideration',
    NO_DUES_CERTIFICATE: 'No Dues Certificate',
    REGISTRATION_RECEIPT: 'Registration Receipt'
  };
  return `${labels[type] || type} — Sy. No. ${survey}`;
}

function docBody(type, ctx) {
  const header = `GOVERNMENT OF MAHARASHTRA\nREVENUE AND FOREST DEPARTMENT\n\n`;
  const meta = `Case No. ${ctx.caseNo}\nSurvey / Plot No.: ${ctx.surveyNo}\nVillage: ${ctx.villageName}, Taluka ${ctx.taluka}\nDistrict: ${ctx.districtName}\n\n`;
  const bodies = {
    PRELIMINARY_NOTIFICATION: `Whereas it appears to the State Government that the land specified below is needed for a public purpose, namely the four-laning of National Highway 353B (Kamptee to Mouda, Package II);\n\nNow, therefore, in exercise of the powers conferred by Section 3A of the National Highways Act, 1956, the State Government hereby notifies its intention to acquire the said land.\n\nSCHEDULE\n  Area          : ${ctx.areaHectares} hectare\n  Classification: ${ctx.landClass}\n  Recorded holder: ${ctx.ownerName}\n\nObjections may be filed before the Collector within sixty days.`,
    OBJECTION_HEARING_MINUTES: `Proceedings of the Collector under Section 15 of the RFCTLARR Act, 2013.\n\nObjections were invited. The following persons were heard:\n  1. ${ctx.ownerName}, recorded holder.\n\nFindings: the objection is disposed of and the extent shall stand corrected to the measured area recorded in the survey report.`,
    SURVEY_REPORT: `Survey conducted jointly by the Land Records Surveyor and the recorded holder, in the presence of the Talathi.\n\n  Notified extent      : ${ctx.notifiedArea} hectare\n  Area found on survey : ${ctx.areaHectares} hectare\n  Land use / crop      : ${ctx.landUse}\n  Irrigated            : ${ctx.irrigated ? 'Yes' : 'No'}\n\nBoundary pillars were fixed at each corner and lime marking applied. Corner photographs with device coordinates are filed in the document vault.`,
    VALUATION_REPORT: `Determination of market value under Section 23 and the First Schedule.\n\n  1. Guidance value for the village : Rs. ${ctx.guidanceRate} per hectare\n  2. Land classification factor      : ${ctx.classFactor}\n  3. Area under acquisition           : ${ctx.areaHectares} hectare\n\n  Market value = Rs. ${ctx.marketValue}\n  Solatium at 100% = Rs. ${ctx.solatium}\n  R&R entitlement = Rs. ${ctx.rrEntitlement}\n  TOTAL = Rs. ${ctx.total}`,
    AWARD: `Award under Section 30 of the RFCTLARR Act, 2013.\n\nThe Collector, being satisfied that the land is needed for the notified public purpose, is pleased to make the following award:\n\n  To ${ctx.ownerName}:\n  Market value .......... Rs. ${ctx.marketValue}\n  Solatium at 100% ...... Rs. ${ctx.solatium}\n  R&R entitlement ....... Rs. ${ctx.rrEntitlement}\n  TOTAL ................. Rs. ${ctx.total}\n\nThe land shall vest in the State Government free from all encumbrances on payment of the compensation.`,
    DRAFT_AWARD: `Draft award placed before the Collector for approval.\n\n  Market value ......... Rs. ${ctx.marketValue}\n  Solatium ............. Rs. ${ctx.solatium}\n  R&R .................. Rs. ${ctx.rrEntitlement}\n  Total ................ Rs. ${ctx.total}`,
    TITLE_VERIFICATION: `Title verification note.\n\n  1. Record of Rights (7/12 extract) for the year ${ctx.rorYear} examined.\n  2. Recorded holder: ${ctx.ownerName}.\n  3. Mutation entries for twelve years scrutinised.\n  4. Encumbrance certificate obtained from the Sub-Registrar.\n  5. Conclusion: the recorded holder has a subsisting right, title and interest.`,
    PAYMENT_ADVICE: `Payment advice.\n\n  Payee: ${ctx.ownerName}\n  Amount released: Rs. ${ctx.total}\n  Scheme head: 5054 - Capital Outlay on Roads and Bridges\n  Method: PFMS direct credit`,
    CONSENT_FORM: `Consent under Section 6 of the RFCTLARR Act, 2013.\n\nI, ${ctx.ownerName}, recorded holder, do hereby give my consent to the acquisition of the said land and to the rehabilitation and resettlement package offered to my family, particulars whereof have been explained to me in Marathi.`,
    POSSESSION_CERTIFICATE: `Possession certificate.\n\nPossession of Survey No. ${ctx.surveyNo}, admeasuring ${ctx.areaHectares} hectare, was taken over on behalf of the State Government, the compensation having been paid in full. The land vests absolutely in the State Government.`,
    ROR_MUTATION_ENTRY: `Record of Rights — mutation entry.\n\nThe name of ${ctx.ownerName} has been removed for the acquired extent and the land entered in the name of the National Highways Authority of India.`,
    LITIGATION_REFERENCE: `Reference to the Land Acquisition, Rehabilitation and Resettlement Authority under Section 64.\n\nThe objection raises a question of title which cannot be decided in these proceedings. The question is referred for adjudication and the acquisition is held in abeyance.`,
    OBJECTION_FILED: `Objection filed under Section 15 of the RFCTLARR Act, 2013.\n\nObjector: ${ctx.ownerName}\nGrounds: the measurement shown is in excess of the actual extent held, and the land devolved under a partition deed not reflected in the Record of Rights.`,
    SALE_DEED_DRAFT: `Draft sale deed for private registration.\n\nVendor: ${ctx.ownerName}\nPurchaser: ${ctx.requesterName}\nSurvey No.: ${ctx.surveyNo}, Village ${ctx.villageName}\nConsideration: Rs. ${ctx.consideration}`,
    ENCUMBRANCE_CERTIFICATE: `Encumbrance certificate issued by the Sub-Registrar, ${ctx.taluka}.\n\nSurvey No. ${ctx.surveyNo} — no subsisting mortgage or charge recorded for the period searched.`,
    SELLER_TITLE_DEED: `Certified copy of the title deed for Survey No. ${ctx.surveyNo}, Village ${ctx.villageName}, in the name of ${ctx.ownerName}.`,
    CONSIDERATION_PROOF: `Proof of consideration for the proposed transfer of Survey No. ${ctx.surveyNo}.\n\nAmount: Rs. ${ctx.consideration}\nMode: bank transfer\n`,
    NO_DUES_CERTIFICATE: `No dues certificate from the Gram Panchayat, ${ctx.villageName}.\n\nNo property tax or other dues outstanding against Survey No. ${ctx.surveyNo}.`,
    REGISTRATION_RECEIPT: `Registration receipt.\n\nDocument registered at the office of the Sub-Registrar, ${ctx.taluka}.\nSurvey No. ${ctx.surveyNo}\nFee paid as per the Maharashtra Stamp Act.`
  };
  return header + meta + (bodies[type] || `Document of type ${type} filed against this case.`);
}

/* ------------------------------------------------------------------ *
 * Geography
 * ------------------------------------------------------------------ */

function voronoiCell(point, sites, bbox) {
  let cell = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]];
  for (const other of sites) {
    if (other === point) continue;
    const dx = other[0] - point[0];
    const dy = other[1] - point[1];
    const mid = [(point[0] + other[0]) / 2, (point[1] + other[1]) / 2];
    const len = Math.hypot(dx, dy) || 1;
    const n = [dx / len, dy / len];
    const out = [];
    for (let i = 0; i < cell.length - 1; i += 1) {
      const cur = cell[i];
      const nxt = cell[i + 1];
      const dCur = (cur[0] - mid[0]) * n[0] + (cur[1] - mid[1]) * n[1];
      const dNxt = (nxt[0] - mid[0]) * n[0] + (nxt[1] - mid[1]) * n[1];
      if (dCur <= 0) out.push(cur);
      if ((dCur <= 0) !== (dNxt <= 0)) {
        const t = dCur / (dCur - dNxt);
        out.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]);
      }
    }
    if (out.length < 3) return null;
    out.push(out[0]);
    cell = out;
  }
  return cell;
}

function buildVillages() {
  const bbox = G.geometryBBox({ type: 'Polygon', coordinates: [DISTRICT.boundary] });
  const cols = 6;
  const rows = 4;
  const sites = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      sites.push([
        bbox[0] + (bbox[2] - bbox[0]) * ((c + 0.5) / cols) + between(-0.012, 0.012),
        bbox[1] + (bbox[3] - bbox[1]) * ((r + 0.5) / rows) + between(-0.010, 0.010)
      ]);
    }
  }
  const districtPoly = [DISTRICT.boundary];
  const villages = [];
  sites.forEach((site, i) => {
    const cell = voronoiCell(site, sites, bbox);
    if (!cell) return;
    const clipped = G.clipPolygon([cell], districtPoly);
    if (!clipped) return;
    const geom = { type: 'Polygon', coordinates: clipped };
    const areaHa = G.geometryAreaHectares(geom);
    if (areaHa < 400) return;
    villages.push({
      name: VILLAGE_NAMES[i % VILLAGE_NAMES.length],
      taluka: pick(['Kamptee', 'Parshivni', 'Mouda', 'Kalmeshwar', 'Saoner', 'Kuhi']),
      lgdCode: `509${1000 + i * 37}`,
      guidanceRatePerHectare: Math.round(between(4200000, 8800000) / 10000) * 10000,
      boundary: geom,
      areaHectares: round(areaHa, 1),
      population: int(700, 5200),
      households: int(160, 1200),
      center: site
    });
  });
  return villages;
}

const CORRIDOR_CONTROL = [
  [78.996, 20.938], [79.042, 20.972], [79.086, 21.008], [79.128, 21.036],
  [79.166, 21.062], [79.204, 21.078], [79.238, 21.062], [79.268, 21.028], [79.286, 20.982]
];
const CORRIDOR_WIDTH_M = 50;

function nearestChainage(dense, pt) {
  let best = Infinity;
  let chain = 0;
  for (const d of dense) {
    const dist = G.haversineM(d.coords, pt);
    if (dist < best) {
      best = dist;
      chain = d.chainage;
    }
  }
  return chain;
}

function sliceIntoParcels(clip, dense, minLen, maxLen) {
  if (!clip || !dense.length) return [];
  const ring = clip[0];
  const tagged = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const c = nearestChainage(dense, ring[i]);
    tagged.push({ pt: ring[i], chainage: c });
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  if (!Number.isFinite(lo) || hi <= lo) return [];

  const span = hi - lo;
  const count = Math.max(1, Math.round(span / ((minLen + maxLen) / 2)));
  const step = span / count;
  const pieces = [];

  for (let k = 0; k < count; k += 1) {
    const low = lo + k * step;
    const high = k === count - 1 ? hi + 1 : lo + (k + 1) * step;
    const cut = (verts, bound, isLow) => {
      const out = [];
      for (let i = 0; i < verts.length; i += 1) {
        const cur = verts[i];
        const nxt = verts[(i + 1) % verts.length];
        const inCur = isLow ? cur.chainage >= bound : cur.chainage <= bound;
        const inNxt = isLow ? nxt.chainage >= bound : nxt.chainage <= bound;
        if (inCur) out.push(cur);
        if (inCur !== inNxt) {
          const denom = nxt.chainage - cur.chainage;
          if (Math.abs(denom) < 1e-9) continue;
          const t = (bound - cur.chainage) / denom;
          out.push({ pt: [cur.pt[0] + (nxt.pt[0] - cur.pt[0]) * t, cur.pt[1] + (nxt.pt[1] - cur.pt[1]) * t], chainage: bound });
        }
      }
      return out.length >= 3 ? out : null;
    };
    const lower = cut(tagged, low, true);
    if (!lower) continue;
    const upper = cut(lower, high, false);
    if (!upper) continue;

    const out = [];
    for (const v of upper) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - v.pt[0]) < 1e-12 && Math.abs(last[1] - v.pt[1]) < 1e-12) continue;
      out.push(v.pt);
    }
    if (out.length < 3) continue;
    const first = out[0];
    const lastPt = out[out.length - 1];
    if (Math.abs(first[0] - lastPt[0]) > 1e-12 || Math.abs(first[1] - lastPt[1]) > 1e-12) out.push([first[0], first[1]]);

    const geom = { type: 'Polygon', coordinates: [out] };
    const areaHa = G.geometryAreaHectares(geom);
    if (!Number.isFinite(areaHa) || areaHa < 0.2 || areaHa > 4) continue;
    pieces.push({ geometry: geom, chainageStart: Math.round(low), chainageEnd: Math.round(high) });
  }

  for (let i = 0; i < pieces.length; i += 1) {
    pieces[i].chainageStart = i === 0 ? Math.round(lo) : pieces[i - 1].chainageEnd;
    pieces[i].chainageEnd = i === pieces.length - 1 ? Math.round(hi) : pieces[i].chainageStart + Math.round(step);
  }
  return pieces;
}

/* ------------------------------------------------------------------ *
 * Seed
 * ------------------------------------------------------------------ */

/** Target stage mix for the acquisition pipeline. */
const STAGE_PLAN = [
  ['NOTIFICATION_ISSUED', 7],
  ['OBJECTIONS_HEARD', 7],
  ['SURVEY_AND_DEMARCATION', 11],
  ['AWARD_DRAFTED', 8],
  ['AWARD_APPROVED', 9],
  ['COMPENSATION_PAID', 9],
  ['POSSESSION_TAKEN', 6],
  ['OBJECTION_UPHELD', 3]
];

async function seed() {
  await migrate();
  const conn = await db();

  // Idempotent: a re-seed starts from a clean slate rather than doubling rows.
  for (const t of [
    'notifications', 'sync_log', 'audit_ledger', 'payments', 'risk_scores',
    'compensation_estimates', 'document_revisions', 'documents', 'discrepancies',
    'field_corners', 'field_captures', 'field_assignments', 'clearance_checks',
    'case_events', 'cases', 'requests', 'parcel_owners', 'parcels', 'villages',
    'projects', 'sessions', 'users'
  ]) {
    await conn.run(`delete from ${t}`);
  }
  if (conn.dialect === 'sqlite') {
    await conn.raw("delete from sqlite_sequence where name not in ('')").catch(() => {});
  }

  const now = NOW;
  const ledger = [];
  const actorRef = { id: null, name: 'NiLaM system', role: 'system' };

  const audit = async (action, subject, detail, actor = actorRef, at = now) => {
    const seq = ledger.length + 1;
    const prev = seq === 1 ? GENESIS : ledger[ledger.length - 1].hash;
    const entry = {
      seq,
      at: iso(at),
      actor_id: actor.id ?? null,
      actor_name: actor.name,
      actor_role: actor.role,
      action,
      subject,
      detail: JSON.stringify(detail ?? null),
      prev_hash: prev
    };
    // Hash exactly the row shape that is stored and later verified. An earlier
    // version hashed `{ ...entry, actor: actor.name }`, a key that exists in no
    // table, so every seeded ledger failed its own integrity check.
    entry.hash = ledgerHash(entry, prev);
    ledger.push(entry);
    return entry;
  };

  /* --- users ------------------------------------------------------- */

  const userSpecs = [
    // Officers
    ['registrar', 'Smt. Kavita Meshram', 'officer', 'sub_registrar', '+91 98220 41188', 'registrar.nagpur@maharashtra.gov.in'],
    ['lao', 'Shri Prakash Deshmukh', 'officer', 'lao', '+91 712 256 0142', 'slao.nh353b@maharashtra.gov.in'],
    ['collector', 'Dr. Anjali Bhosale, IAS', 'officer', 'collector', '+91 712 256 0001', 'collector.nagpur@maharashtra.gov.in'],
    ['treasury', 'Shri Gajanan Tandulkar', 'officer', 'treasury', '+91 712 256 0199', 'dto.nagpur@maharashtra.gov.in'],
    // Government / requesting agency
    ['nhai', 'Shri Sudhir Nagpure', 'government', null, '+91 712 256 0233', 'piu.nagpur@nhai.gov.in'],
    // Field verifiers
    ['surveyor1', 'Shri Bhaskar Kalbande', 'field_verifier', null, '+91 98600 22110', 'fv1.nagpur@maharashtra.gov.in'],
    ['surveyor2', 'Smt. Vaishali Bhende', 'field_verifier', null, '+91 98600 22111', 'fv2.nagpur@maharashtra.gov.in'],
    // Citizens
    ['ramesh', 'Shri Ramesh Patil', 'citizen', null, '+91 90280 11223', 'ramesh.patil@example.in'],
    ['sunita', 'Smt. Sunita Gedam', 'citizen', null, '+91 90280 44556', 'sunita.gedam@example.in'],
    ['vithal', 'Shri Vithal Wankhede', 'citizen', null, '+91 90280 77889', 'vithal.wankhede@example.in']
  ];

  const users = {};
  for (const [username, fullName, role, designation, phone, email] of userSpecs) {
    const { hash, salt } = hashPassword('nilam@2026');
    const res = await conn.run(
      `insert into users (username, password_hash, password_salt, full_name, role, designation, district, phone, language, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, 'en', ?)`,
      [username, hash, salt, fullName, role, designation, DISTRICT.name, phone, iso(now)]
    );
    users[username] = { id: res.lastInsertRowid, name: fullName, role, designation, email };
  }

  const auditor = await (async () => {
    const { hash, salt } = hashPassword('nilam@2026');
    const r = await conn.run(
      `insert into users (username, password_hash, password_salt, full_name, role, designation, district, phone, language, created_at)
       values ('auditor', ?, ?, 'Shri Mohan Khedkar', 'auditor', null, ?, '+91 712 256 0300', 'en', ?)`,
      [hash, salt, DISTRICT.name, iso(now)]
    );
    return { id: r.lastInsertRowid, name: 'Shri Mohan Khedkar', role: 'auditor' };
  })();

  await audit('SEED_USERS_CREATED', 'users', { count: Object.keys(users).length + 1 });

  /* --- villages ---------------------------------------------------- */

  const villages = buildVillages();
  const villageIds = [];
  for (const v of villages) {
    const r = await conn.run(
      `insert into villages (name, taluka, district, state, lgd_code, guidance_rate_per_hectare, boundary, area_hectares, population, households)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.name, v.taluka, DISTRICT.name, DISTRICT.state, v.lgdCode,
       v.guidanceRatePerHectare, JSON.stringify(v.boundary), v.areaHectares, v.population, v.households]
    );
    villageIds.push({ ...v, id: r.lastInsertRowid });
  }
  await audit('SEED_VILLAGES_CREATED', 'villages', { count: villageIds.length });

  /* --- projects ---------------------------------------------------- */

  const dense = G.densify(CORRIDOR_CONTROL, 100);
  let acc = 0;
  const denseLine = dense.map((coords, i) => {
    if (i > 0) acc += G.haversineM(dense[i - 1], coords);
    return { coords, chainage: acc };
  });
  const corridor = G.corridorPolygon(dense, CORRIDOR_WIDTH_M);

  const acqProject = await (async () => {
    const r = await conn.run(
      `insert into projects (code, name, track, agency, legal_track, district, state, status, budget_inr, corridor, created_at, created_by)
       values (?, ?, 'acquisition', ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ['NH-353B-PKG2', 'NH-353B Four-Laning — Kamptee to Mouda (Package II)',
       'National Highways Authority of India',
       'NH Act 1956 s.3A–3H read with RFCTLARR 2013 First Schedule',
       DISTRICT.name, DISTRICT.state, 19500000000, JSON.stringify({ type: 'MultiPolygon', coordinates: [corridor] }),
       iso(now - 420 * DAY), users.nhai.id]
    );
    return { id: r.lastInsertRowid, code: 'NH-353B-PKG2', track: 'acquisition', name: 'NH-353B Four-Laning — Kamptee to Mouda (Package II)', centerline: CORRIDOR_CONTROL };
  })();

  const purchaseProject = await (async () => {
    const r = await conn.run(
      `insert into projects (code, name, track, agency, legal_track, district, state, status, budget_inr, corridor, created_at, created_by)
       values (?, ?, 'purchase', ?, ?, ?, ?, 'active', ?, null, ?, ?)`,
      ['PVT-NAG-2026', 'Private land purchases — Nagpur district (citizen requests)',
       'Department of Registration and Stamps, Maharashtra',
       'Registration Act 1908 / Maharashtra Stamp Act 1958',
       DISTRICT.name, DISTRICT.state, 0, iso(now - 120 * DAY), users.registrar.id]
    );
    return { id: r.lastInsertRowid, code: 'PVT-NAG-2026', track: 'purchase' };
  })();

  await audit('SEED_PROJECTS_CREATED', 'projects', { acquisition: acqProject.code, purchase: purchaseProject.code });

  /* --- parcels, owners, cases -------------------------------------- */

  const stagePlan = [];
  for (const [stage, count] of STAGE_PLAN) for (let i = 0; i < count; i += 1) stagePlan.push(stage);

  const parcelRows = [];
  let parcelIndex = 0;

  for (const village of villageIds) {
    if (parcelIndex >= stagePlan.length) break;
    const clipped = G.clipPolygon(corridor, village.boundary.coordinates);
    if (!clipped) continue;
    const pieces = sliceIntoParcels(clipped, denseLine, 250, 450);

    for (const piece of pieces) {
      if (parcelIndex >= stagePlan.length) break;
      const areaHa = round(G.geometryAreaHectares(piece.geometry), 4);
      if (areaHa <= 0.2 || areaHa > 4) continue;

      const landClass = (() => {
        const roll = rng();
        if (roll < 0.6) return 'agricultural';
        if (roll < 0.76) return 'homestead';
        if (roll < 0.84) return 'commercial';
        if (roll < 0.94) return 'barren';
        return 'waterbody';
      })();

      const guidance = Math.round((village.guidanceRatePerHectare * (LAND_CLASS_FACTORS[landClass] ?? 1)) / 10000) * 10000;
      const surveyNo = `${int(11, 148)}/${int(1, 4)}${pick(['', 'A', 'B'])}`;
      const stage = stagePlan[parcelIndex];
      const centroid = G.geometryCentroid(piece.geometry);

      // Deliberate risk realism: some parcels carry co-owners, disputes,
      // encumbrances or a prior acquisition attempt so the clearance checks and
      // PULSE have genuine signal.
      const coOwnerCount = parcelIndex % 5 === 0 ? int(2, 4) : 1;
      const hasLitigation = parcelIndex % 11 === 3;
      const hasTitleDispute = stage === 'OBJECTION_UPHELD' || parcelIndex % 13 === 5;
      const hasEncumbrance = parcelIndex % 7 === 2;
      const priorAcquisition = parcelIndex % 17 === 4;
      const rorOnFile = parcelIndex % 9 !== 6;

      const parcelRes = await conn.run(
        `insert into parcels (survey_no, plot_no, village_id, project_id, record_area_hectares, notified_area_hectares,
            land_class, land_use, guidance_rate_per_hectare, irrigated, structures, trees,
            distance_to_road_m, distance_to_town_km, geometry, centroid, chainage_start_m, chainage_end_m,
            ror_year, ror_on_file, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          surveyNo, String(int(101, 899)), village.id, acqProject.id,
          areaHa, round(areaHa * 1.04, 4), landClass, pick(LAND_USES[landClass]),
          guidance, rng() > 0.45 ? 1 : 0,
          landClass === 'homestead' ? pick(['Pucca house, 2 rooms', 'Semi-pucca house, 3 rooms']) : (rng() > 0.85 ? 'Boundary wall' : null),
          int(0, 14), int(60, 2400), round(between(0.4, 9), 1),
          JSON.stringify(piece.geometry), JSON.stringify(centroid),
          piece.chainageStart, piece.chainageEnd, String(2020 + int(0, 4)), rorOnFile ? 1 : 0, iso(now - 400 * DAY)
        ]
      );
      const parcelId = parcelRes.lastInsertRowid;

      // Owners
      const owners = [];
      /*
       * The first three parcels belong to the three demonstration citizens, so
       * their names must be the recorded owners. An earlier version linked
       * ramesh/sunita/vithal as the user_id but still wrote a random generated
       * name as owner_name, so a citizen logging in saw "your land" owned by a
       * stranger. The honourific ("Shri"/"Smt.") is stripped because the record
       * holds the name, not the salutation.
       */
      const linkedCitizen = parcelIndex === 0 ? users.ramesh : parcelIndex === 1 ? users.sunita : parcelIndex === 2 ? users.vithal : null;
      const primary = linkedCitizen
        ? {
            name: linkedCitizen.name.replace(/^(Shri|Smt|Dr)\.?\s+/i, ''),
            guardian: `S/o Late ${linkedCitizen.name.split(/\s+/).pop()}`
          }
        : personName();
      const rrEntitlement = landClass === 'homestead' || landClass === 'agricultural' ? int(1, 5) * 25000 : 0;
      const ownerRes = await conn.run(
        `insert into parcel_owners (parcel_id, user_id, owner_name, guardian_name, identity_provider, identity_token,
            identity_verified, share_numerator, share_denominator, is_legal_heir, contact_phone, consent_state, created_at)
         values (?, ?, ?, ?, 'digilocker-demo', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          parcelId,
          linkedCitizen ? linkedCitizen.id : null,
          primary.name, primary.guardian,
          `DL-${sha256(`${surveyNo}-${primary.name}`).slice(0, 16).toUpperCase()}`,
          parcelIndex % 4 === 0 ? 1 : 0,
          1, coOwnerCount, 0,
          `+91 9${int(100000000, 899999999)}`,
          stage === 'OBJECTION_UPHELD' ? 'objected' : (rng() > 0.5 ? 'consented' : 'pending'),
          iso(now - 380 * DAY)
        ]
      );
      owners.push(ownerRes.lastInsertRowid);

      // Co-owners / legal heirs
      for (let c = 1; c < coOwnerCount; c += 1) {
        const co = personName();
        const r = await conn.run(
          `insert into parcel_owners (parcel_id, owner_name, guardian_name, identity_provider, identity_token,
              identity_verified, share_numerator, share_denominator, is_legal_heir, contact_phone, consent_state, created_at)
           values (?, ?, ?, 'digilocker-demo', ?, ?, 1, ?, 1, ?, 'pending', ?)`,
          [
            parcelId, co.name, co.guardian,
            `DL-${sha256(`${surveyNo}-${co.name}-${c}`).slice(0, 16).toUpperCase()}`,
            rng() > 0.5 ? 1 : 0, coOwnerCount,
            `+91 9${int(100000000, 899999999)}`, iso(now - 360 * DAY)
          ]
        );
        owners.push(r.lastInsertRowid);
      }

      parcelRows.push({
        id: parcelId, surveyNo, village, landClass, areaHa, guidance, stage,
        centroid, geometry: piece.geometry, owners, rrEntitlement,
        coOwnerCount, hasLitigation, hasTitleDispute, hasEncumbrance, priorAcquisition,
        rorOnFile, chainageStart: piece.chainageStart, index: parcelIndex
      });
      parcelIndex += 1;
    }
  }

  await audit('SEED_PARCELS_CREATED', 'parcels', { count: parcelRows.length });

  /* --- case timeline per parcel ------------------------------------ */

  const pipelineStages = STAGES;
  const cases = [];
  let docCounter = 0;
  const allCaptures = [];
  const allDiscrepancies = [];

  for (const p of parcelRows) {
    const parcelRef = p;
    const blocked = p.stage === 'OBJECTION_UPHELD';
    const stageIdx = pipelineStages.findIndex((s) => s.id === p.stage);
    const reached = blocked
      ? pipelineStages.filter((s) => s.order > 0 && s.order <= 3)
      : pipelineStages.filter((s) => s.order > 0 && s.order <= stageIdx + 1);

    // SLA spread: a healthy majority, a real at-risk minority, a genuine breach
    // minority. A board where everything is green demonstrates nothing.
    let finalDwell;
    if (blocked) finalDwell = int(20, 140);
    else {
      const sla = pipelineStages[stageIdx].slaDays;
      const roll = rng();
      const factor = roll < 0.68 ? between(0.12, 0.62) : roll < 0.87 ? between(0.79, 0.98) : between(1.05, 1.9);
      finalDwell = Math.max(1, Math.round(sla * factor));
    }

    /*
     * The SLA distribution is built here and must survive to the database.
     *
     * An earlier version computed each stage's enteredAt from the one after it
     * and then shifted the whole history by a per-parcel `stagger`. That shift
     * silently changed how long the *current* stage had been open, so the SLA
     * verdict came out wrong for most cases — 37 of 54 showed as overdue, which
     * does not describe a functioning office.
     *
     * The current stage's dwell is now set first and is authoritative: the
     * stagger is baked into `currentEntered` rather than applied afterwards.
     */
    const stagger = (parcelRows.length - p.index) * int(1, 3) * DAY * 0.15;
    const currentEntered = now - finalDwell * DAY - stagger;

    // Walk backwards: each earlier stage finished shortly before the next began.
    const history = new Array(reached.length);
    history[reached.length - 1] = {
      stageId: reached[reached.length - 1].id,
      enteredAt: currentEntered,
      completedAt: null,
      dwellDays: finalDwell
    };
    let cursor = currentEntered;
    for (let k = reached.length - 2; k >= 0; k -= 1) {
      const stage = reached[k];
      const dwell = int(Math.round(stage.slaDays * 0.35), Math.round(stage.slaDays * 1.15));
      const completedAt = cursor - int(2, 12) * DAY;
      history[k] = { stageId: stage.id, enteredAt: completedAt - dwell * DAY, completedAt, dwellDays: dwell };
      cursor = completedAt - dwell * DAY;
    }

    const stageEnteredAt = history[history.length - 1].enteredAt;
    // Survey numbers repeat across villages in the same district, so the village
    // is part of the case number. Without it two parcels collide on case_no.
    const caseNo = blocked
      ? `NILAM/ACQ/${p.village.name.toUpperCase().replace(/\s+/g, '')}/${p.surveyNo.replace('/', '-')}/LIT`
      : `NILAM/ACQ/${p.village.name.toUpperCase().replace(/\s+/g, '')}/${p.surveyNo.replace('/', '-')}`;

    // Assign the case to the officer who owns the current stage.
    const owner = STAGE_BY_ID.get(p.stage).actorRole;
    const assignedTo = owner === 'field_verifier'
      ? (p.index % 2 === 0 ? users.surveyor1.id : users.surveyor2.id)
      : owner === 'collector' ? users.collector.id
        : owner === 'treasury' ? users.treasury.id
          : users.lao.id;

    const caseRes = await conn.run(
      `insert into cases (case_no, track, project_id, parcel_id, owner_id, stage, stage_entered_at, priority,
          assigned_to, assigned_at, area_requested_hectares, created_at, updated_at)
       values (?, 'acquisition', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        caseNo, acqProject.id, p.id, p.owners[0], p.stage, iso(stageEnteredAt),
        p.hasLitigation || p.hasTitleDispute ? 'high' : (p.coOwnerCount > 2 ? 'normal' : 'normal'),
        assignedTo, iso(stageEnteredAt), p.areaHa, iso(history[0].enteredAt), iso(stageEnteredAt)
      ]
    );
    const caseId = caseRes.lastInsertRowid;

    for (let k = 0; k < history.length; k += 1) {
      const h = history[k];
      await conn.run(
        `insert into case_events (case_id, at, action, from_stage, to_stage, actor_id, actor_name, actor_role, reason, detail)
         values (?, ?, 'STAGE_ENTERED', ?, ?, ?, ?, ?, ?, ?)`,
        [
          caseId, iso(h.enteredAt), k === 0 ? null : history[k - 1].stageId, h.stageId,
          users.lao.id, users.lao.name, 'officer',
          k === 0
            ? 'Preliminary notification published in the Gazette and two local newspapers.'
            : `Statutory stage completed in ${h.dwellDays} days.`,
          JSON.stringify({ dwellDays: h.dwellDays })
        ]
      );
    }

    // Clearance checks, evaluated per parcel as the brief requires.
    const clearance = runClearanceChecks({
      litigation: p.hasLitigation ? [{ ref: `WP/${int(100, 999)}/2024`, court: 'Bombay High Court, Nagpur Bench' }] : [],
      titleDispute: p.hasTitleDispute,
      coOwnerCount: p.coOwnerCount,
      allCoOwnersConsented: false,
      encumbrance: p.hasEncumbrance ? { type: 'mortgage', holder: 'Vidarbha Konkan Gramin Bank' } : null,
      priorAcquisition: p.priorAcquisition ? { ref: 'LAQ/NH-6/2019/114', year: 2019 } : null,
      rorOnFile: p.rorOnFile
    });
    for (const item of clearance.items) {
      await conn.run(
        `insert into clearance_checks (case_id, item_id, label, clear, severity, action, evidence, checked_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [caseId, item.id, item.label, item.clear ? 1 : 0, item.severity,
         item.action, JSON.stringify({ parcelId: p.id }), iso(stageEnteredAt)]
      );
    }
    p.clearance = clearance;

    /* --- documents ------------------------------------------------ */

    const produced = new Set();
    reached.forEach((s) => s.producesDocs.forEach((d) => produced.add(d)));
    STAGE_BY_ID.get(p.stage).producesDocs.forEach((d) => produced.add(d));
    if (blocked) produced.add('LITIGATION_REFERENCE');
    if (p.hasTitleDispute) produced.add('OBJECTION_FILED');
    if (p.landClass === 'homestead' && stageIdx >= 3) produced.add('CONSENT_FORM');

    // Withhold a prerequisite on some cases so "missing documents" is real.
    const withhold = p.index % 9 === 6 ? [...produced][[...produced].length - 1] : null;

    const docCtx = {
      caseNo, surveyNo: p.surveyNo, villageName: p.village.name, taluka: p.village.taluka,
      districtName: DISTRICT.name, areaHectares: p.areaHa, notifiedArea: round(p.areaHa * 1.04, 4),
      landClass: p.landClass, landUse: pick(LAND_USES[p.landClass]), irrigated: rng() > 0.45,
      guidanceRate: p.guidance, classFactor: LAND_CLASS_FACTORS[p.landClass], rorYear: String(2021 + int(0, 4)),
      ownerName: `${personName().name}`, rrEntitlement: p.rrEntitlement,
      marketValue: 0, solatium: 0, total: 0, consideration: 0, requesterName: ''
    };
    const floor = statutoryFloor({
      areaHectares: p.areaHa, guidanceRatePerHectare: p.guidance,
      landClass: p.landClass, rrEntitlement: p.rrEntitlement
    });
    docCtx.marketValue = floor.marketValue;
    docCtx.solatium = floor.solatium;
    docCtx.total = floor.total;
    p.floor = floor;

    for (const type of produced) {
      if (type === withhold) continue;
      const title = docTitle(type, p.surveyNo);
      const docRes = await conn.run(
        `insert into documents (case_id, parcel_id, doc_type, title, current_revision, issued_to_vault, vault_reference, created_at)
         values (?, ?, ?, ?, 1, ?, ?, ?)`,
        [caseId, p.id, type, title, rng() > 0.4 ? 1 : 0,
         `VAULT-${sha256(`${caseNo}-${type}`).slice(0, 12).toUpperCase()}`, iso(stageEnteredAt)]
      );
      const documentId = docRes.lastInsertRowid;
      const revisions = type === 'PRELIMINARY_NOTIFICATION' || type === 'DRAFT_AWARD' ? 2 : 1;
      let parentHash = null;
      for (let r = 1; r <= revisions; r += 1) {
        docCounter += 1;
        const body = `${docBody(type, docCtx)}\n\n---\nRevision ${r} of ${revisions}. Case No. ${caseNo}.\nGenerated by the NiLaM document engine.`;
        const buf = Buffer.from(body, 'utf8');
        const hash = sha256(buf);
        await conn.run(
          `insert into document_revisions (document_id, revision, body, content_hash, parent_hash, byte_size, author_id, author_name, author_role, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, 'officer', ?)`,
          [documentId, r, body, hash, parentHash, buf.length, users.lao.id, users.lao.name, iso(stageEnteredAt + r * DAY)]
        );
        parentHash = hash;
        await conn.run('update documents set current_revision = ? where id = ?', [r, documentId]);
      }
      await audit('DOCUMENT_ISSUED', `case:${caseId}`, { type, title, revisions }, users.lao, stageEnteredAt);
    }

    /* --- field verification --------------------------------------- */

    const surveyed = reached.some((s) => s.id === 'SURVEY_AND_DEMARCATION');
    if (surveyed) {
      const assignment = await conn.run(
        `insert into field_assignments (case_id, parcel_id, verifier_id, status, assigned_at, due_at, completed_at)
         values (?, ?, ?, 'submitted', ?, ?, ?)`,
        [caseId, p.id, assignedTo, iso(stageEnteredAt - 5 * DAY), iso(stageEnteredAt + 10 * DAY), iso(stageEnteredAt + 3 * DAY)]
      );

      /**
       * Capture the whole perimeter, not a subset of "corners".
       *
       * A surveyor walks the boundary and records each vertex. An earlier version
       * kept only vertices with a sharp direction change, which silently dropped
       * collinear vertices; because the polygon is then closed by joining the
       * remaining vertices, that cut area away and produced false area
       * mismatches (ratios up to 3.3x with no real mis-survey).
       *
       * The two deliberate defects below are what the discrepancy engine is
       * meant to catch, so they are applied on top of an otherwise faithful ring.
       */
      const ringPts = p.geometry.coordinates[0].slice(0, -1);
      const corners = [];
      for (let c = 0; c < ringPts.length; c += 1) {
        const base = ringPts[c];
        // Small, realistic GNSS scatter around the true vertex (~1 m).
        const jitter = 0.000009;
        corners.push({
          index: c + 1,
          lat: round(base[1] + between(-jitter, jitter), 7),
          lon: round(base[0] + between(-jitter, jitter), 7),
          accuracy: round(between(3, 9), 1),
          heading: Math.round(rng() * 359),
          altitude: round(between(280, 330), 1),
          capturedAt: (stageEnteredAt + 3 * DAY) + c * 12 * 60000,
          photoHash: sha256(`${p.id}-corner-${c}`),
          mock: false
        });
      }
      const cornerCount = corners.length;

      /* Deliberate discrepancies, so the flagging features have real work to do.
         Every 6th surveyed parcel is mis-surveyed: its captured ring encloses a
         materially larger area than the record. Every 7th has a corner that
         falls outside the notified boundary. */
      const misSurveyed = p.index % 6 === 1;
      const cornerOutside = p.index % 7 === 2;
      const suspicious = p.index % 11 === 6;

      if (misSurveyed) {
        // Push corners outward by ~12% so the enclosed area grows well beyond the
        // 5% tolerance the demo is configured with.
        const c0 = G.geometryCentroid(p.geometry);
        for (const c of corners) {
          c.lon = round(c0[0] + (c.lon - c0[0]) * 1.12, 7);
          c.lat = round(c0[1] + (c.lat - c0[1]) * 1.12, 7);
        }
      }
      if (cornerOutside) {
        corners[1].lon = round(corners[1].lon + 0.0045, 7);
        corners[1].lat = round(corners[1].lat + 0.0045, 7);
      }
      if (suspicious) {
        // Identical coordinates across corners is the classic mock-location tell.
        for (const c of corners) {
          c.lon = corners[0].lon;
          c.lat = corners[0].lat;
        }
        corners[0].mock = true;
      }

      const cornerPolygon = {
        type: 'Polygon',
        coordinates: [[...corners.map((c) => [c.lon, c.lat]), [corners[0].lon, corners[0].lat]]]
      };
      const surveyedArea = round(G.geometryAreaHectares(cornerPolygon), 4);
      const clientArea = round(surveyedArea * (0.99 + rng() * 0.02), 4);

      const captureRes = await conn.run(
        `insert into field_captures (capture_ref, case_id, parcel_id, verifier_id, verifier_name, status,
            surveyed_area_hectares, client_area_hectares, polygon, corner_count, gps_flagged,
            captured_at, synced_at, synced_offline, note, device)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `CAP-${String(caseId).padStart(5, '0')}`, caseId, p.id, assignedTo,
          assignedTo === users.surveyor1.id ? users.surveyor1.name : users.surveyor2.name,
          'verified', surveyedArea, clientArea, JSON.stringify(cornerPolygon), cornerCount,
          suspicious ? 1 : 0, iso(stageEnteredAt + 3 * DAY), iso(stageEnteredAt + 3 * DAY + 3600000),
          p.index % 3 === 0 ? 1 : 0,
          pick([
            'All four corners located with the boundary pillars visible.',
            'Corners marked with lime; landholder present throughout.',
            'Corner 3 required a second reading due to tree cover.'
          ]),
          'NiLaM Field (Android 14)'
        ]
      );
      const captureId = captureRes.lastInsertRowid;

      for (const c of corners) {
        await conn.run(
          `insert into field_corners (capture_id, corner_index, latitude, longitude, accuracy_m, heading_deg, altitude_m, point, photo_hash, photo_path, captured_at, is_mock_location)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [captureId, c.index, c.lat, c.lon, c.accuracy, c.heading, c.altitude,
           JSON.stringify([c.lon, c.lat]), c.photoHash, `/field-photos/${c.photoHash}.jpg`, iso(c.capturedAt), c.mock ? 1 : 0]
        );
      }

      await conn.run('update field_assignments set status = ? where id = ?', ['submitted', assignment.lastInsertRowid]);
      allCaptures.push({ caseId, captureId, parcel: p, corners, cornerPolygon, surveyedArea, clientArea, misSurveyed, cornerOutside, suspicious });
    }

    cases.push({ id: caseId, caseNo, parcel: p, clearance, stageEnteredAt });
  }

  await audit('SEED_CASES_CREATED', 'cases', { count: cases.length });

  /* --- purchase track ---------------------------------------------- */

  // Three purchase parcels in Kamptee, plus requests from the demo citizens.
  const purchaseSpecs = [
    { citizen: 'ramesh', surveyNo: '77/2', stage: 'DOCUMENTS_CHECKED', village: 0, offer: 4200000 },
    { citizen: 'sunita', surveyNo: '91/1A', stage: 'OWNER_VERIFIED', village: 0, offer: 2750000 },
    { citizen: 'vithal', surveyNo: '103/3B', stage: 'REQUEST_SUBMITTED', village: 1, offer: 6100000 }
  ];

  let purchaseSeq = 0;
  for (const spec of purchaseSpecs) {
    purchaseSeq += 1;
    const village = villageIds[spec.village % villageIds.length];
    const areaHa = round(between(0.12, 0.55), 4);
    const cx = village.center[0] + between(-0.004, 0.004);
    const cy = village.center[1] + between(-0.004, 0.004);
    const d = 0.0009;
    const geom = {
      type: 'Polygon',
      coordinates: [[[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d], [cx - d, cy - d]]]
    };
    const guidance = Math.round((village.guidanceRatePerHectare * 1.6) / 10000) * 10000;

    const parcelRes = await conn.run(
      `insert into parcels (survey_no, plot_no, village_id, project_id, record_area_hectares, land_class, land_use,
          guidance_rate_per_hectare, irrigated, geometry, centroid, ror_year, ror_on_file, created_at)
       values (?, ?, ?, ?, ?, 'homestead', 'Residential', ?, 0, ?, ?, '2025', 1, ?)`,
      [spec.surveyNo, String(int(101, 899)), village.id, purchaseProject.id, areaHa, guidance,
       JSON.stringify(geom), JSON.stringify([cx, cy]), iso(now - 200 * DAY)]
    );
    const parcelId = parcelRes.lastInsertRowid;

    const seller = personName();
    const sellerRes = await conn.run(
      `insert into parcel_owners (parcel_id, owner_name, guardian_name, identity_provider, identity_token, identity_verified, contact_phone, consent_state, consent_at, created_at)
       values (?, ?, ?, 'digilocker-demo', ?, 1, ?, 'consented', ?, ?)`,
      [parcelId, seller.name, seller.guardian, `DL-${sha256(`seller-${spec.surveyNo}`).slice(0, 16).toUpperCase()}`,
       `+91 9${int(100000000, 899999999)}`, iso(now - 20 * DAY), iso(now - 190 * DAY)]
    );

    const reqRes = await conn.run(
      `insert into requests (reference, track, requester_id, parcel_id, project_id, intended_use, offer_amount_inr, consideration_inr, status, current_stage, created_at, updated_at)
       values (?, 'purchase', ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
      [
        `NILAM/PUR/${new Date(now).getFullYear()}/${String(1000 + purchaseSeq)}`, users[spec.citizen].id,
        parcelId, purchaseProject.id, pick(['Residential', 'Small business', 'Farming']),
        spec.offer, Math.round(spec.offer * 0.94), spec.stage, iso(now - 45 * DAY), iso(now - 6 * DAY)
      ]
    );
    const requestId = reqRes.lastInsertRowid;

    const stageDef = PURCHASE_STAGE_BY_ID.get(spec.stage);
    const reached = PURCHASE_STAGES.filter((s) => s.order <= stageDef.order);
    const caseEntered = now - int(3, 20) * DAY;

    const purchaseCaseRes = await conn.run(
      `insert into cases (case_no, track, project_id, parcel_id, owner_id, request_id, stage, stage_entered_at, priority, assigned_to, assigned_at, area_requested_hectares, created_at, updated_at)
       values (?, 'purchase', ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?)`,
      [
        `NILAM/PUR/${spec.surveyNo.replace('/', '-')}`, purchaseProject.id, parcelId,
        sellerRes.lastInsertRowid, requestId, spec.stage, iso(caseEntered),
        users.registrar.id, iso(caseEntered), areaHa, iso(now - 44 * DAY), iso(caseEntered)
      ]
    );
    const pCaseId = purchaseCaseRes.lastInsertRowid;

    for (const s of reached) {
      await conn.run(
        `insert into case_events (case_id, at, action, from_stage, to_stage, actor_id, actor_name, actor_role, reason, detail)
         values (?, ?, 'STAGE_ENTERED', ?, ?, ?, ?, 'officer', ?, '{}')`,
        [pCaseId, iso(caseEntered - (stageDef.order - s.order) * 5 * DAY), null, s.id,
         users.registrar.id, users.registrar.name,
         s.order === 1 ? 'Request received from the citizen portal.' : 'Stage completed on scrutiny.']
      );
    }

    const clearance = runClearanceChecks({ coOwnerCount: 1, rorOnFile: true });
    for (const item of clearance.items) {
      await conn.run(
        `insert into clearance_checks (case_id, item_id, label, clear, severity, action, evidence, checked_at)
         values (?, ?, ?, ?, ?, ?, '{}', ?)`,
        [pCaseId, item.id, item.label, item.clear ? 1 : 0, item.severity, item.action, iso(caseEntered)]
      );
    }

    // Purchase documents.
    const purchaseDocs = reached.flatMap((s) => s.requiredDocs || []);
    for (const type of [...new Set(['SELLER_TITLE_DEED', 'ENCUMBRANCE_CERTIFICATE', ...purchaseDocs])]) {
      const ctx = {
        caseNo: `NILAM/PUR/${spec.surveyNo.replace('/', '-')}`, surveyNo: spec.surveyNo,
        villageName: village.name, taluka: village.taluka, districtName: DISTRICT.name,
        ownerName: seller.name, requesterName: users[spec.citizen].name,
        consideration: spec.offer, areaHectares: areaHa, guidanceRate: guidance,
        rrEntitlement: 0, marketValue: 0, solatium: 0, total: 0, rorYear: '2025', landUse: 'Residential',
        landClass: 'homestead', classFactor: 1.6
      };
      const docRes = await conn.run(
        `insert into documents (case_id, parcel_id, doc_type, title, current_revision, issued_to_vault, vault_reference, created_at)
         values (?, ?, ?, ?, 1, 1, ?, ?)`,
        [pCaseId, parcelId, type, docTitle(type, spec.surveyNo),
         `VAULT-${sha256(`pur-${spec.surveyNo}-${type}`).slice(0, 12).toUpperCase()}`, iso(now - 40 * DAY)]
      );
      const body = docBody(type, ctx);
      const buf = Buffer.from(body, 'utf8');
      await conn.run(
        `insert into document_revisions (document_id, revision, body, content_hash, parent_hash, byte_size, author_id, author_name, author_role, created_at)
         values (?, 1, ?, ?, null, ?, ?, ?, 'citizen', ?)`,
        [docRes.lastInsertRowid, body, sha256(buf), buf.length, users[spec.citizen].id, users[spec.citizen].name, iso(now - 40 * DAY)]
      );
    }

    await conn.run(
      `insert into notifications (user_id, case_id, kind, title, body, needs_action, next_step, created_at)
       values (?, ?, 'status', ?, ?, ?, ?, ?)`,
      [
        users[spec.citizen].id, pCaseId,
        `Update on your land request ${spec.surveyNo}`,
        `Your request has reached the "${stageDef.short}" step.`,
        1, 'Open the case to see what is needed from you.', iso(now - 2 * DAY)
      ]
    );

    cases.push({ id: pCaseId, caseNo: `NILAM/PUR/${spec.surveyNo.replace('/', '-')}`, track: 'purchase', clearance });
  }

  await audit('SEED_PURCHASE_REQUESTS', 'requests', { count: purchaseSpecs.length });

  /* --- discrepancy detection (server-authoritative) ----------------- */

  const tolerance = Number(process.env.NILAM_AREA_TOLERANCE || 0.05);
  const accuracyMax = Number(process.env.NILAM_ACCURACY_MAX_M || 15);

  for (const cap of allCaptures) {
    const csv = [];
    const p = cap.parcel;
    const recordArea = p.areaHa;
    const notifiedArea = round(p.areaHa * 1.04, 4);

    // 1. Area mismatch against BOTH the record and the notified extent.
    for (const [against, expected] of [['record', recordArea], ['notified', notifiedArea]]) {
      const delta = (cap.surveyedArea - expected) / expected;
      if (Math.abs(delta) > tolerance) {
        csv.push({
          type: 'AREA_MISMATCH', severity: 'critical',
          detail: `The surveyed area is ${(Math.abs(delta) * 100).toFixed(1)}% ${delta > 0 ? 'larger' : 'smaller'} than the ${against} area (tolerance ${(tolerance * 100).toFixed(0)}%).`,
          measured: cap.surveyedArea, expected, delta
        });
        break; // one area finding per capture is enough
      }
    }

    // 2. Corners outside or far from the notified boundary.
    const outside = cap.corners.filter((c) => !G.geometryContains(p.geometry, [c.lon, c.lat]));
    if (outside.length) {
      const distances = outside.map((c) => G.haversineM([c.lon, c.lat], p.centroid));
      csv.push({
        type: 'CORNER_OUTSIDE_BOUNDARY', severity: 'critical',
        detail: `${outside.length} of ${cap.corners.length} captured corners fall outside the notified boundary (furthest ${Math.round(Math.max(...distances))} m from the parcel centre).`,
        measured: outside.length, expected: 0, delta: null
      });
    }

    // 3. Suspicious GPS: identical coordinates, mock flag, or poor accuracy.
    const unique = new Set(cap.corners.map((c) => `${c.lon},${c.lat}`));
    const worstAccuracy = Math.max(...cap.corners.map((c) => c.accuracy));
    const reasons = [];
    if (unique.size < cap.corners.length) reasons.push(`${cap.corners.length - unique.size} corner(s) share identical coordinates`);
    if (cap.corners.some((c) => c.mock)) reasons.push('the device reported a mock location');
    if (worstAccuracy > accuracyMax) reasons.push(`reported accuracy reached ±${worstAccuracy} m (limit ±${accuracyMax} m)`);
    if (reasons.length) {
      csv.push({
        type: 'SUSPICIOUS_GPS', severity: 'warning',
        detail: `The capture location is not reliable: ${reasons.join('; ')}.`,
        measured: worstAccuracy, expected: accuracyMax, delta: null
      });
    }

    /* 4. Overlap with a neighbouring parcel in the same village.
     *
     * Measured as a fraction of the surveyed area, not "does any corner land in
     * the neighbour". Adjacent parcels legitimately share a boundary, so a
     * single corner inside the next plot is normal and was previously flagging
     * every capture in the dataset. A real overlap is a material shared area.
     */
    let overlap = null;
    let overlapRatio = 0;
    const surveyBBox = G.geometryBBox(cap.cornerPolygon);
    for (const other of parcelRows) {
      if (other.id === p.id || other.village.id !== p.village.id) continue;
      const otherBBox = G.geometryBBox(other.geometry);
      if (!G.bboxIntersects(surveyBBox, otherBBox)) continue;

      // Sample a grid across the surveyed polygon's bounding box and count the
      // points that are inside BOTH polygons. At these parcel sizes a 40x40 grid
      // resolves the shared area to well inside the tolerance below.
      const steps = 40;
      let insideBoth = 0;
      let insideSurvey = 0;
      for (let i = 0; i < steps; i += 1) {
        for (let j = 0; j < steps; j += 1) {
          const x = surveyBBox[0] + ((surveyBBox[2] - surveyBBox[0]) * (i + 0.5)) / steps;
          const y = surveyBBox[1] + ((surveyBBox[3] - surveyBBox[1]) * (j + 0.5)) / steps;
          if (!G.geometryContains(cap.cornerPolygon, [x, y])) continue;
          insideSurvey += 1;
          if (G.geometryContains(other.geometry, [x, y])) insideBoth += 1;
        }
      }
      if (insideSurvey === 0) continue;
      const ratio = insideBoth / insideSurvey;
      if (ratio > overlapRatio) {
        overlapRatio = ratio;
        overlap = other;
      }
    }
    // 2% of the surveyed area is the threshold: below that it is boundary noise.
    if (overlap && overlapRatio > 0.02) {
      csv.push({
        type: 'NEIGHBOUR_OVERLAP', severity: 'critical',
        detail: `The surveyed polygon overlaps Survey No. ${overlap.surveyNo} across about ${(overlapRatio * 100).toFixed(1)}% of its area.`,
        measured: round(overlapRatio, 4), expected: 0, delta: round(overlapRatio, 4)
      });
    }

    for (const d of csv) {
      await conn.run(
        `insert into discrepancies (case_id, capture_id, type, severity, detail, measured_value, expected_value, delta_ratio, detected_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cap.caseId, cap.captureId, d.type, d.severity, d.detail, d.measured ?? null, d.expected ?? null, d.delta ?? null, iso(now - 2 * DAY)]
      );
      allDiscrepancies.push({ caseId: cap.caseId, ...d });
    }

    // Status is derived from the discrepancies, never from a client flag.
    const flagged = csv.some((d) => d.severity === 'critical');
    await conn.run(
      'update field_captures set status = ? where id = ?',
      [flagged ? 'flagged' : 'verified', cap.captureId]
    );
    await conn.run(
      'update cases set area_surveyed_hectares = ?, updated_at = ? where id = ?',
      [cap.surveyedArea, iso(now - 2 * DAY), cap.caseId]
    );

    await audit(
      flagged ? 'FIELD_CAPTURE_FLAGGED' : 'FIELD_CAPTURE_VERIFIED',
      `case:${cap.caseId}`,
      { captureId: cap.captureId, surveyedArea: cap.surveyedArea, recordArea, discrepancies: csv.map((d) => d.type) }
    );
  }

  await audit('SEED_DISCREPANCIES_COMPUTED', 'discrepancies', { count: allDiscrepancies.length });

  /* --- compensation estimates (statutory floor) --------------------- */

  for (const c of cases.filter((x) => x.track !== 'purchase')) {
    const p = c.parcel;
    await conn.run(
      `insert into compensation_estimates (case_id, source, model_version, amount_inr, statutory_floor_inr, below_floor, factors, created_at)
       values (?, 'statutory', 'floor-v1', ?, ?, 0, ?, ?)`,
      [c.id, p.floor.total, p.floor.total,
       JSON.stringify({
         areaHectares: p.floor.areaHectares,
         guidanceRate: p.floor.guidanceRatePerHectare,
         landClassFactor: p.floor.landClassFactor,
         marketValue: p.floor.marketValue,
         solatium: p.floor.solatium,
         rrEntitlement: p.floor.rrEntitlement
       }), iso(now)]
    );
  }

  /* --- ledger finalise -------------------------------------------- */

  for (const e of ledger) {
    await conn.run(
      `insert into audit_ledger (seq, at, actor_id, actor_name, actor_role, action, subject, detail, prev_hash, hash)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.seq, e.at, e.actor_id, e.actor_name, e.actor_role, e.action, e.subject, e.detail, e.prev_hash, e.hash]
    );
  }

  /* --- summary ----------------------------------------------------- */

  const summary = {
    users: (await conn.get('select count(*) as n from users')).n,
    villages: (await conn.get('select count(*) as n from villages')).n,
    parcels: (await conn.get('select count(*) as n from parcels')).n,
    owners: (await conn.get('select count(*) as n from parcel_owners')).n,
    cases: (await conn.get('select count(*) as n from cases')).n,
    acquisitionCases: (await conn.get("select count(*) as n from cases where track = 'acquisition'")).n,
    purchaseCases: (await conn.get("select count(*) as n from cases where track = 'purchase'")).n,
    documents: (await conn.get('select count(*) as n from documents')).n,
    revisions: (await conn.get('select count(*) as n from document_revisions')).n,
    captures: (await conn.get('select count(*) as n from field_captures')).n,
    flaggedCaptures: (await conn.get("select count(*) as n from field_captures where status = 'flagged'")).n,
    corners: (await conn.get('select count(*) as n from field_corners')).n,
    discrepancies: (await conn.get('select count(*) as n from discrepancies')).n,
    clearanceBlockers: (await conn.get("select count(*) as n from clearance_checks where clear = 0 and severity = 'critical'")).n,
    ledger: (await conn.get('select count(*) as n from audit_ledger')).n
  };

  return summary;
}

const summary = await seed();
console.log('NiLaM seed complete\n');
for (const [k, v] of Object.entries(summary)) {
  console.log(`  ${k.padEnd(18)} ${v}`);
}
await closeDb();
