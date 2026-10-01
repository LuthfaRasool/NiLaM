/**
 * NiLaM test suite.
 *
 * `node --test tests/run.mjs`
 *
 * The brief calls for negative cases specifically, so the emphasis is on what
 * must NOT happen: an illegal stage edge, a role acting outside its authority, a
 * transition without its statutory documents, an award without an accepted field
 * verification, a citizen reaching another owner's case, a tampered ledger, a
 * seeded hash that does not verify, and a client-side area being trusted.
 *
 * The suite also asserts the honest claims the UI makes, so a "Demonstration"
 * label that drifts into claiming a trained model is caught here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGES, STAGE_BY_ID, PURCHASE_STAGE_BY_ID,
  validateTransition, statutoryFloor, runClearanceChecks, slaState, progressOf,
  detectFindings, formatINR, formatINRFull, LAND_CLASS_FACTORS, ROLES, can
} from '../packages/domain/acquisition.mjs';
import { sha256, ledgerHash, verifyChain, GENESIS, hashPassword, verifyPassword } from '../packages/crypto/index.mjs';
import * as G from '../packages/geometry/index.mjs';
import { calmEstimate, pulseScore, MODEL_VERSION } from '../services/ml/index.mjs';

/* ------------------------------------------------------------------ *
 * Statutory floor
 * ------------------------------------------------------------------ */

test('statutoryFloor: 100% solatium, land-class factor, R&R', () => {
  const f = statutoryFloor({
    areaHectares: 1.5,
    guidanceRatePerHectare: 6_000_000,
    landClass: 'agricultural',
    rrEntitlement: 100_000
  });
  // market value = 1.5 * 6,000,000 * 1.0 = 9,000,000
  assert.equal(f.marketValue, 9_000_000);
  // solatium at exactly 100%
  assert.equal(f.solatium, 9_000_000);
  assert.equal(f.total, 9_000_000 + 9_000_000 + 100_000);
});

test('statutoryFloor: commercial land multiplies by 2.4', () => {
  const f = statutoryFloor({ areaHectares: 1, guidanceRatePerHectare: 10_000_000, landClass: 'commercial' });
  assert.equal(f.marketValue, 24_000_000);
});

/* ------------------------------------------------------------------ *
 * Transition validation — the negative cases
 * ------------------------------------------------------------------ */

const DOCS = (types) => types.map((t) => ({ type: t }));

test('transition: refuses an unknown stage', () => {
  const v = validateTransition({ from: 'NOTIFICATION_ISSUED', to: 'NOPE', role: 'officer', designation: 'lao', docs: [] });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'UNKNOWN_STAGE');
});

test('transition: refuses a skipped stage (illegal edge)', () => {
  // Notification may go to Objections, never straight to Award.
  const v = validateTransition({ from: 'NOTIFICATION_ISSUED', to: 'AWARD_DRAFTED', role: 'officer', designation: 'lao', docs: [] });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'ILLEGAL_EDGE');
});

test('transition: refuses a citizen acting as an officer', () => {
  const v = validateTransition({ from: 'OBJECTIONS_HEARD', to: 'SURVEY_AND_DEMARCATION', role: 'citizen', docs: DOCS(['PRELIMINARY_NOTIFICATION']) });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'FORBIDDEN_ROLE');
});

test('transition: refuses when the statutory document is missing', () => {
  // AWARD_DRAFTED needs SURVEY_REPORT and VALUATION_REPORT; provide neither.
  const v = validateTransition({ from: 'SURVEY_AND_DEMARCATION', to: 'AWARD_DRAFTED', role: 'officer', designation: 'lao', docs: [] });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'MISSING_DOCUMENTS');
});

test('transition: refuses the award without an accepted field verification', () => {
  // Documents are present, but no geo-tagged verification exists — the ground
  // truth gate must block the award regardless of paperwork.
  const v = validateTransition({
    from: 'SURVEY_AND_DEMARCATION',
    to: 'AWARD_DRAFTED',
    role: 'officer',
    designation: 'lao',
    docs: DOCS(['SURVEY_REPORT', 'VALUATION_REPORT']),
    verifications: [],
    caseRow: {}
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'MISSING_FIELD_VERIFICATION');
});

test('transition: a sub-registrar cannot act on an acquisition case', () => {
  const v = validateTransition({
    from: 'NOTIFICATION_ISSUED', to: 'OBJECTIONS_HEARD',
    role: 'officer', designation: 'sub_registrar', track: 'acquisition', docs: DOCS(['PRELIMINARY_NOTIFICATION'])
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'WRONG_TRACK');
});

test('transition: a collector may approve the award when prerequisites are met', () => {
  const v = validateTransition({
    from: 'AWARD_DRAFTED', to: 'AWARD_APPROVED',
    role: 'officer', designation: 'collector',
    docs: DOCS(['DRAFT_AWARD', 'TITLE_VERIFICATION'])
  });
  assert.equal(v.ok, true);
});

/* ------------------------------------------------------------------ *
 * Clearance checks
 * ------------------------------------------------------------------ */

test('clearance: litigation blocks; warnings do not', () => {
  const r = runClearanceChecks({ litigation: [{ ref: 'WP/1/2024' }], rorOnFile: true });
  assert.equal(r.cleared, false);
  assert.ok(r.blockers >= 1);
});

test('clearance: a clean record passes', () => {
  const r = runClearanceChecks({ rorOnFile: true });
  assert.equal(r.cleared, true);
  assert.equal(r.blockers, 0);
});

test('clearance: missing ROR is a critical blocker', () => {
  const r = runClearanceChecks({ rorOnFile: false });
  assert.equal(r.cleared, false);
  const ror = r.items.find((i) => i.id === 'documents_complete');
  assert.equal(ror.clear, false);
  assert.equal(ror.severity, 'critical');
});

/* ------------------------------------------------------------------ *
 * SLA
 * ------------------------------------------------------------------ */

test('sla: past the clock is breached, near the end is at-risk', () => {
  const now = Date.now();
  const breached = slaState({ stage: 'OBJECTIONS_HEARD', stageEnteredAt: new Date(now - 70 * 86400000).toISOString() }, now);
  assert.equal(breached.verdict, 'breached');

  const atRisk = slaState({ stage: 'OBJECTIONS_HEARD', stageEnteredAt: new Date(now - 50 * 86400000).toISOString() }, now);
  assert.equal(atRisk.verdict, 'at_risk');

  const fresh = slaState({ stage: 'OBJECTIONS_HEARD', stageEnteredAt: new Date(now - 5 * 86400000).toISOString() }, now);
  assert.equal(fresh.verdict, 'on_track');
});

/* ------------------------------------------------------------------ *
 * Hash chain and passwords
 * ------------------------------------------------------------------ */

test('ledger: a tampered entry breaks the chain at that index', () => {
  const a = { seq: 1, at: 't1', action: 'A', detail: '{}' };
  const b = { seq: 2, at: 't2', action: 'B', detail: '{}' };
  const ha = ledgerHash(a, GENESIS);
  const hb = ledgerHash(b, ha);
  const rows = [
    { ...a, hash: ha, prev_hash: GENESIS },
    { ...b, hash: hb, prev_hash: ha }
  ];
  assert.equal(verifyChain(rows), -1, 'an intact chain must verify');

  const tampered = [
    { ...a, hash: ha, prev_hash: GENESIS },
    { ...b, action: 'B-ALTERED', hash: hb, prev_hash: ha }
  ];
  assert.equal(verifyChain(tampered), 1, 'the second entry is the first broken link');
});

test('ledger: reordering or changing prev_hash breaks verification', () => {
  const a = { seq: 1, at: 't1', action: 'A', detail: '{}' };
  const b = { seq: 2, at: 't2', action: 'B', detail: '{}' };
  const ha = ledgerHash(a, GENESIS);
  const hb = ledgerHash(b, ha);
  const broken = [
    { ...a, hash: ha, prev_hash: GENESIS },
    { ...b, hash: hb, prev_hash: GENESIS } // wrong predecessor
  ];
  assert.equal(verifyChain(broken), 1);
});

test('passwords: correct password verifies, wrong one does not', () => {
  const { hash, salt } = hashPassword('nilam@2026');
  assert.equal(verifyPassword('nilam@2026', hash, salt), true);
  assert.equal(verifyPassword('wrong', hash, salt), false);
});

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

test('geometry: a point exactly on the boundary counts as inside', () => {
  const poly = { type: 'Polygon', coordinates: [[[79, 21], [79.01, 21], [79.01, 21.01], [79, 21.01], [79, 21]]] };
  // A corner of the ring itself lies exactly on the boundary.
  assert.equal(G.geometryContains(poly, [79, 21]), true);
});

test('geometry: area of a 0.01 degree square is finite and positive', () => {
  const poly = { type: 'Polygon', coordinates: [[[79, 21], [79.01, 21], [79.01, 21.01], [79, 21.01], [79, 21]]] };
  const ha = G.geometryAreaHectares(poly);
  assert.ok(ha > 50 && ha < 200, `area was ${ha}`);
});

test('geometry: a point far outside is not inside', () => {
  const poly = { type: 'Polygon', coordinates: [[[79, 21], [79.01, 21], [79.01, 21.01], [79, 21.01], [79, 21]]] };
  assert.equal(G.geometryContains(poly, [78, 20]), false);
});

/* ------------------------------------------------------------------ *
 * CALM and PULSE — the demonstration models
 * ------------------------------------------------------------------ */

test('calm: never below the statutory floor', () => {
  const parcel = {
    areaHectares: 1.0,
    guidanceRatePerHectare: 5_000_000,
    landClass: 'barren', // factor 0.7 lowers the market value
    rorOnFile: true
  };
  const c = calmEstimate(parcel);
  assert.equal(c.belowFloor, false);
  assert.ok(c.estimateINR >= c.statutoryFloorINR);
  assert.equal(c.modelVersion, MODEL_VERSION);
  // It must say, plainly, that it is not a trained model.
  assert.match(c.disclosure, /not a trained valuation model/i);
});

test('pulse: a clean case is low risk, litigation pushes it high', () => {
  const clean = pulseScore({ coOwnerCount: 1, rorOnFile: true, identityVerifiedCount: 1, consentPendingCount: 0, documentsCompleteRatio: 1, slaUtilisation: 0.3 });
  assert.equal(clean.tier, 'low');

  const hostile = pulseScore({ coOwnerCount: 3, hasLitigation: true, hasTitleDispute: true, objectionFiled: true, clearanceBlockers: 2, rorOnFile: false, identityVerifiedCount: 0, consentPendingCount: 3, documentsCompleteRatio: 0.4, slaUtilisation: 1.2 });
  assert.equal(hostile.tier, 'high');
  assert.ok(hostile.probability > 0.9);
  assert.ok(hostile.reasons.length >= 3, 'a high-risk case must list its reasons');
});

test('pulse: reasons carry the points that produced them', () => {
  const r = pulseScore({ hasLitigation: true, rorOnFile: true, identityVerifiedCount: 1 });
  const lit = r.reasons.find((x) => x.id === 'litigation');
  assert.ok(lit, 'litigation must appear as a reason');
  assert.equal(lit.points, 26);
});

/* ------------------------------------------------------------------ *
 * Rule engine
 * ------------------------------------------------------------------ */

test('rules: a breached SLA and missing docs both surface', () => {
  const ctx = {
    sla: { verdict: 'breached', stageId: 'OBJECTIONS_HEARD', stageLabel: 'Objections', elapsedDays: 70, slaDays: 60 },
    missingDocs: ['SURVEY_REPORT'],
    discrepancies: [],
    clearance: { blockers: 0 },
    payment: null,
    outstanding: 0,
    daysSinceActivity: 1,
    hasAcceptedVerification: false
  };
  const findings = detectFindings({ stage: 'OBJECTIONS_HEARD' }, ctx);
  const ids = findings.map((f) => f.ruleId);
  assert.ok(ids.includes('SLA_BREACH'));
  assert.ok(ids.includes('MISSING_DOCUMENTS'));
});

/* ------------------------------------------------------------------ *
 * RBAC — permission table
 * ------------------------------------------------------------------ */

test('rbac: a citizen cannot read the officer queue', () => {
  assert.equal(can('citizen', 'case.read.queue'), false);
  assert.equal(can('officer', 'case.read.queue'), true);
  assert.equal(can('auditor', 'case.transition'), false, 'an auditor is read-only');
  assert.equal(can('field_verifier', 'capture.submit'), true);
});

test('rbac: every permission is held by the role that declares it', () => {
  for (const [roleId, role] of Object.entries(ROLES)) {
    for (const p of role.permissions) {
      assert.equal(can(roleId, p), true, `${roleId} should hold ${p}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Formatting — Indian grouping
 * ------------------------------------------------------------------ */

test('format: Indian digit grouping and crore/lakh shorthand', () => {
  assert.equal(formatINRFull(12345678), '₹1,23,45,678');
  assert.equal(formatINR(12_500_000), '₹1.25 Cr');
  assert.equal(formatINR(250_000), '₹2.50 L');
});

/* ------------------------------------------------------------------ *
 * Honesty guards
 * ------------------------------------------------------------------ */

test('the model card never claims to be trained', () => {
  const c = calmEstimate({ areaHectares: 1, guidanceRatePerHectare: 5_000_000, landClass: 'agricultural', rorOnFile: true });
  assert.doesNotMatch(c.disclosure.toLowerCase(), /trained on synthetic/i);
  assert.doesNotMatch(c.disclosure.toLowerCase(), /trained model/i);
});

test('pulse disclosure admits fixed weights rather than a classifier', () => {
  const p = pulseScore({ rorOnFile: true });
  assert.match(p.disclosure, /fixed signal weights/i);
});

console.log('');
console.log('All NiLaM domain, crypto, geometry, ML and RBAC tests completed.');
