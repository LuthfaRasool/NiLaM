/**
 * CALM and PULSE.
 *
 * These are **demonstration weighted-factor models**, not trained machine-learning
 * models. The weights live in `services/ml/build_models.py` and are mirrored here
 * so the API can serve a decision without a Python subprocess on the request path.
 *
 * The two implementations are kept deliberately identical in behaviour, and
 * `tests/` asserts that the Python report and this module agree on the worked
 * examples. If they ever diverge, one of them is wrong and the test says so.
 *
 * CALM also reconciles against the statutory floor. The floor is the legal
 * authority: CALM may estimate above it and is never permitted below it, and the
 * stored row records whether the model fell short.
 */

import { statutoryFloor, LAND_CLASS_FACTORS, formatINR } from '../../packages/domain/acquisition.mjs';

export const MODEL_VERSION = 'calm-demo-1.0.0+pulse-demo-1.0.0';

/* ------------------------------------------------------------------ *
 * CALM — compensation estimate
 * ------------------------------------------------------------------ */

/** Uplifts applied on top of the statutory structure, each itemised. */
const CALM_UPLIFTS = [
  { id: 'road_frontage', label: 'Road frontage', rate: 0.07,
    holds: (p) => (p.distanceToRoadM ?? 9999) < 300,
    because: 'the parcel abuts a road, which raises realisable value' },
  { id: 'near_town', label: 'Proximity to a town', rate: 0.05,
    holds: (p) => (p.distanceToTownKm ?? 99) < 2.0,
    because: 'the parcel is within two kilometres of an urban area' },
  { id: 'irrigated', label: 'Irrigated land', rate: 0.045,
    holds: (p) => Boolean(p.irrigated),
    because: 'assured irrigation supports a higher crop value' }
];

const CALM_BASE_SPREAD = 0.10;
const CALM_SPREAD_PENALTIES = [
  { id: 'no_ror', add: 0.05, holds: (p) => !p.rorOnFile, because: 'the Record of Rights extract is not on file' },
  { id: 'far_from_road', add: 0.03, holds: (p) => (p.distanceToRoadM ?? 0) > 1200, because: 'access is poor, which makes comparable sales harder to apply' },
  { id: 'large_parcel', add: 0.02, holds: (p) => (p.areaHectares ?? 0) > 2.5, because: 'large parcels transact less often, so comparables are thinner' }
];

/**
 * Estimates compensation with a readable factor breakdown.
 *
 * @param {object} parcel  normalised parcel fields
 * @param {number} villageAvgRate  the village guidance rate, for the class line
 */
export function calmEstimate(parcel, villageAvgRate = null) {
  const area = Number(parcel.areaHectares) || 0;
  const rate = Number(parcel.guidanceRatePerHectare) || 0;
  const landClass = parcel.landClass || 'agricultural';
  const factor = LAND_CLASS_FACTORS[landClass] ?? 1.0;
  const villageAvg = Number(villageAvgRate) || rate;

  // The statutory structure, exactly as the law sets it out.
  const marketValue = area * rate;
  const solatium = marketValue * 1.0;
  const rr = Number(parcel.rrEntitlement) || 0;
  const statutorySubtotal = marketValue + solatium + rr;

  const factors = [
    { id: 'market_value', label: 'Market value (area × guidance rate)', amount: round2(marketValue), kind: 'statutory' },
    { id: 'solatium', label: 'Solatium at 100%', amount: round2(solatium), kind: 'statutory' },
    { id: 'rr', label: 'Rehabilitation and resettlement entitlement', amount: round2(rr), kind: 'statutory' }
  ];

  // The class factor is already inside the rate when the caller supplies an
  // adjusted rate; show the separate line only when it is not.
  if (Math.abs(rate - villageAvg) <= 1) {
    factors.splice(1, 0, {
      id: 'land_class',
      label: `Land classification: ${landClass}`,
      amount: round2(marketValue * (factor - 1.0)),
      kind: 'statutory',
      note: `applied as a factor of ${factor.toFixed(2)} against the village guidance rate`
    });
  }

  let upliftTotal = 0;
  for (const u of CALM_UPLIFTS) {
    let applies = false;
    try {
      applies = u.holds(parcel);
    } catch {
      applies = false;
    }
    if (!applies) continue;
    const amount = marketValue * u.rate;
    upliftTotal += amount;
    factors.push({
      id: u.id, label: u.label, amount: round2(amount), kind: 'demonstration',
      ratePercent: round2(u.rate * 100), note: u.because
    });
  }

  const structures = Number(parcel.structuresValue) || 0;
  if (structures > 0) {
    factors.push({
      id: 'structures', label: 'Structures on the land', amount: round2(structures),
      kind: 'statutory', note: 'compensated separately from the land value'
    });
  }

  const treeCount = Number(parcel.treeCount) || 0;
  const treeValue = treeCount > 0 ? treeCount * 6000 : 0;
  if (treeValue > 0) {
    factors.push({
      id: 'trees', label: `Trees (${treeCount})`, amount: round2(treeValue),
      kind: 'demonstration', note: 'a flat demonstration rate of ₹6,000 per tree'
    });
  }

  const estimate = statutorySubtotal + upliftTotal + structures + treeValue;

  let spread = CALM_BASE_SPREAD;
  const spreadReasons = [];
  for (const p of CALM_SPREAD_PENALTIES) {
    let holds = false;
    try {
      holds = p.holds(parcel);
    } catch {
      holds = false;
    }
    if (holds) {
      spread += p.add;
      spreadReasons.push(p.because);
    }
  }
  if (!spreadReasons.length) spreadReasons.push('the record is complete and comparable sales are available');

  // Reconcile against the legal minimum. The floor governs; the model informs.
  const floor = statutoryFloor({
    areaHectares: area,
    guidanceRatePerHectare: rate,
    landClass,
    rrEntitlement: rr
  });
  const belowFloor = estimate < floor.total;

  return {
    model: 'CALM',
    modelVersion: MODEL_VERSION,
    kind: 'demonstration weighted-factor model',
    estimateINR: round2(estimate),
    estimateFormatted: formatINR(estimate),
    rangeLowINR: round2(estimate * (1 - spread)),
    rangeHighINR: round2(estimate * (1 + spread)),
    spreadPercent: round2(spread * 100),
    spreadReason: spreadReasons.join('; '),
    statutorySubtotalINR: round2(statutorySubtotal),
    statutoryFloorINR: floor.total,
    statutoryFloorFormatted: formatINR(floor.total),
    // Stated explicitly so the UI can say which figure governs.
    belowFloor,
    governingAmountINR: belowFloor ? floor.total : round2(estimate),
    governingBasis: belowFloor
      ? 'The statutory floor governs. The model estimate is lower and is not used for payment.'
      : 'The model estimate governs, being above the statutory floor.',
    factors,
    disclosure:
      'Demonstration model. The estimate is a weighted-factor calculation, not a trained valuation model, and it is not a substitute for the determination under s.23.'
  };
}

/* ------------------------------------------------------------------ *
 * PULSE — delay and litigation risk
 * ------------------------------------------------------------------ */

const PULSE_SIGNALS = [
  { id: 'litigation', label: 'A court case is pending over this land', points: 26, holds: (c) => Boolean(c.hasLitigation) },
  { id: 'title_dispute', label: 'Ownership is disputed', points: 24, holds: (c) => Boolean(c.hasTitleDispute) },
  { id: 'objection', label: 'The landholder has filed an objection', points: 18, holds: (c) => Boolean(c.objectionFiled) },
  { id: 'clearance_blocker', label: 'A critical clearance check is unresolved', points: 14, holds: (c) => Number(c.clearanceBlockers || 0) > 0 },
  { id: 'sla_slipping', label: 'The statutory clock is slipping', points: 12, holds: (c) => Number(c.slaUtilisation || 0) > 0.75 },
  { id: 'encumbrance', label: 'The land is mortgaged or charged', points: 10, holds: (c) => Boolean(c.hasEncumbrance) },
  { id: 'prior_acquisition', label: 'An earlier acquisition attempt exists', points: 9, holds: (c) => Boolean(c.priorAcquisition) },
  { id: 'no_ror', label: 'The Record of Rights extract is not on file', points: 9, holds: (c) => !c.rorOnFile },
  { id: 'consent_pending', label: 'Owner consent is still pending', points: 7, perUnit: true, maxUnits: 3,
    holds: (c) => Number(c.consentPendingCount || 0) > 0, units: (c) => Number(c.consentPendingCount || 0) },
  { id: 'co_owners', label: 'Multiple co-owners or legal heirs', points: 5, perUnit: true, maxUnits: 3,
    holds: (c) => Number(c.coOwnerCount || 1) > 1, units: (c) => Math.max(0, Number(c.coOwnerCount || 1) - 1) },
  { id: 'identity_unverified', label: "An owner's identity is not yet verified", points: 6,
    holds: (c) => Number(c.identityVerifiedCount || 0) < Number(c.coOwnerCount || 1) },
  { id: 'missing_documents', label: 'Required documents are incomplete', points: 6,
    holds: (c) => Number(c.documentsCompleteRatio ?? 1) < 0.8 }
];

const PULSE_MIDPOINT = 34.0;
const PULSE_STEEPNESS = 0.055;

/** Logistic map from points to probability. No fitted parameters. */
export function pulseScore(caseCtx) {
  const reasons = [];
  let total = 0;

  for (const s of PULSE_SIGNALS) {
    let holds = false;
    try {
      holds = s.holds(caseCtx);
    } catch {
      holds = false;
    }
    if (!holds) continue;

    let units = 1;
    if (s.perUnit && s.units) {
      try {
        units = Number(s.units(caseCtx)) || 1;
      } catch {
        units = 1;
      }
    }
    if (s.maxUnits) units = Math.min(units, s.maxUnits);

    const points = s.perUnit && units > 1 ? s.points * units : s.points;
    if (points <= 0) continue;
    total += points;
    reasons.push({
      id: s.id,
      label: s.perUnit && units > 1 ? `${s.label} (${units})` : s.label,
      points: round1(points)
    });
  }

  const probability = 1 / (1 + Math.pow(Math.E, -(total - PULSE_MIDPOINT) * PULSE_STEEPNESS));

  for (const r of reasons) {
    r.sharePercent = total > 0 ? round1((100 * r.points) / total) : 0;
  }
  reasons.sort((a, b) => b.points - a.points);

  const tier = probability >= 0.55 ? 'high' : probability >= 0.25 ? 'medium' : 'low';
  const actions = {
    high: "Place this case in the Collector's weekly review and resolve the highest-scoring issue before the next stage.",
    medium: 'Watch this case. Address the top one or two reasons at the next hearing.',
    low: 'No special action needed. Keep to the ordinary schedule.'
  };

  return {
    model: 'PULSE',
    modelVersion: MODEL_VERSION,
    kind: 'demonstration weighted-signal model',
    probability: Math.round(probability * 10000) / 10000,
    probabilityPercent: Math.round(probability * 1000) / 10,
    tier,
    score: round1(total),
    reasons,
    reasonCount: reasons.length,
    recommendedAction: actions[tier],
    disclosure:
      'Demonstration model. The probability comes from fixed signal weights, not a trained classifier, and is one input to a decision that remains the officer\'s.'
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/** Maps a database parcel row onto the CALM input shape. */
export function parcelInputFromRow(row, villageAvgRate = null) {
  return {
    areaHectares: Number(row.record_area_hectares),
    guidanceRatePerHectare: Number(row.guidance_rate_per_hectare),
    landClass: row.land_class,
    irrigated: Boolean(row.irrigated),
    structuresValue: 0,
    treeCount: Number(row.trees || 0),
    distanceToRoadM: row.distance_to_road_m === null ? null : Number(row.distance_to_road_m),
    distanceToTownKm: row.distance_to_town_km === null ? null : Number(row.distance_to_town_km),
    rrEntitlement: 0,
    rorOnFile: Boolean(row.ror_on_file),
    villageAvgRate
  };
}

/** Maps a case context onto the PULSE input shape. */
export function pulseInputFromContext(ctx) {
  const owners = ctx.owners || [];
  // Completeness is the share of the *current stage's* required document types
  // that are on file. An earlier version divided the document count by itself,
  // which always produced 1.0 and silently disabled this signal.
  const requiredTypes = ctx.stage?.requiredDocs || [];
  const presentTypes = new Set((ctx.docs || []).map((d) => d.doc_type));
  const documentsCompleteRatio = requiredTypes.length
    ? requiredTypes.filter((t) => presentTypes.has(t)).length / requiredTypes.length
    : 1;

  return {
    coOwnerCount: owners.length || 1,
    hasLitigation: (ctx.clearance?.items || []).some((i) => i.id === 'litigation' && !i.clear),
    hasTitleDispute: (ctx.clearance?.items || []).some((i) => i.id === 'title_dispute' && !i.clear),
    hasEncumbrance: (ctx.clearance?.items || []).some((i) => i.id === 'encumbrance' && !i.clear),
    priorAcquisition: (ctx.clearance?.items || []).some((i) => i.id === 'prior_acquisition' && !i.clear),
    objectionFiled: ctx.caseRow?.stage === 'OBJECTION_UPHELD' || owners.some((o) => o.consent_state === 'objected'),
    rorOnFile: Boolean(ctx.parcel?.ror_on_file),
    identityVerifiedCount: owners.filter((o) => o.identity_verified).length,
    consentPendingCount: owners.filter((o) => o.consent_state === 'pending').length,
    documentsCompleteRatio,
    clearanceBlockers: ctx.clearance?.blockers ?? 0,
    slaUtilisation: ctx.sla?.utilisation ?? 0,
    areaHectares: Number(ctx.parcel?.record_area_hectares) || 0,
    distanceToTownKm: ctx.parcel?.distance_to_town_km === null ? null : Number(ctx.parcel?.distance_to_town_km)
  };
}
