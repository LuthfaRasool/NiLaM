/**
 * Shared API plumbing: authentication, RBAC, the audit ledger and the case
 * context builder.
 *
 * Extracted from `server.mjs` so that `routes.mjs` and `server.mjs` can both use
 * it without importing each other. A cycle here would be a runtime hazard rather
 * than a style issue: whichever module is evaluated second would see a partially
 * initialised binding.
 */

import { db } from '../../db/index.mjs';
import {
  ROLES, can, STAGE_BY_ID, PURCHASE_STAGE_BY_ID, STAGES, PURCHASE_STAGES,
  validateTransition, slaState, progressOf, statutoryFloor, runClearanceChecks,
  detectFindings, formatINRFull, DOC_TYPE_BY_ID
} from '../../packages/domain/acquisition.mjs';
import { ledgerHash, GENESIS } from '../../packages/crypto/index.mjs';

export const nowIso = () => new Date().toISOString();

export function jparse(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function fail(res, status, code, message, details) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

/* ------------------------------------------------------------------ *
 * Audit ledger
 * ------------------------------------------------------------------ */

/**
 * Appends one entry to the hash-chained ledger.
 *
 * The chain is the system's evidence of who did what. Every state-changing
 * route calls this, and the tests assert the ledger length grew rather than
 * trusting that it did.
 */
export async function appendLedger(conn, { actor, action, subject, detail = null, at = null }) {
  const last = await conn.get('select seq, hash from audit_ledger order by seq desc limit 1');
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.hash ?? GENESIS;
  const entry = {
    seq,
    at: at ?? nowIso(),
    actor_id: actor?.id ?? null,
    actor_name: actor?.name ?? 'system',
    actor_role: actor?.role ?? 'system',
    action,
    subject: subject ?? null,
    detail: JSON.stringify(detail)
  };
  entry.hash = ledgerHash(entry, prev);
  await conn.run(
    `insert into audit_ledger (seq, at, actor_id, actor_name, actor_role, action, subject, detail, prev_hash, hash)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.seq, entry.at, entry.actor_id, entry.actor_name, entry.actor_role,
     entry.action, entry.subject, entry.detail, prev, entry.hash]
  );
  return entry;
}

/* ------------------------------------------------------------------ *
 * Authentication / authorisation
 * ------------------------------------------------------------------ */

export async function currentUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const conn = await db();
  const session = await conn.get('select token, user_id, expires_at from sessions where token = ?', [token]);
  if (!session) return null;
  if (Date.parse(session.expires_at) < Date.now()) {
    await conn.run('delete from sessions where token = ?', [token]);
    return null;
  }
  const user = await conn.get('select * from users where id = ?', [session.user_id]);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.full_name,
    role: user.role,
    designation: user.designation,
    district: user.district,
    language: user.language
  };
}

/**
 * Deny by default.
 *
 * A route that declares no permission is treated as a misconfiguration and
 * answers 500, so an accidentally unprotected route fails loudly in development
 * rather than silently exposing data in production.
 */
export function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      if (!permission) {
        return fail(res, 500, 'ROUTE_MISCONFIGURED', 'This route declares no permission. Deny by default.');
      }
      const user = await currentUser(req);
      if (!user) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
      if (!can(user.role, permission)) {
        return fail(res, 403, 'FORBIDDEN', 'Your role does not permit this action.', {
          required: permission,
          role: user.role,
          designation: user.designation
        });
      }
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/* ------------------------------------------------------------------ *
 * Case context
 * ------------------------------------------------------------------ */

/** Assembles the full decision context for one case. */
export async function buildCaseContext(conn, caseRow, { now = Date.now() } = {}) {
  const parcel = await conn.get('select * from parcels where id = ?', [caseRow.parcel_id]);
  const village = parcel ? await conn.get('select * from villages where id = ?', [parcel.village_id]) : null;
  const owners = await conn.all('select * from parcel_owners where parcel_id = ? order by id', [caseRow.parcel_id]);

  const docs = await conn.all(
    `select d.id, d.doc_type, d.title, d.current_revision, d.issued_to_vault, d.vault_reference,
            r.content_hash, r.parent_hash, r.revision, r.created_at
     from documents d
     left join document_revisions r on r.document_id = d.id and r.revision = d.current_revision
     where d.case_id = ? order by d.id`,
    [caseRow.id]
  );

  const capture = await conn.get('select * from field_captures where case_id = ? order by id desc limit 1', [caseRow.id]);
  const discrepancies = await conn.all('select * from discrepancies where case_id = ? order by severity, id', [caseRow.id]);
  const clearanceRows = await conn.all('select * from clearance_checks where case_id = ? order by id', [caseRow.id]);
  const payment = await conn.get('select * from payments where case_id = ? order by id desc limit 1', [caseRow.id]);
  const calm = await conn.get("select * from compensation_estimates where case_id = ? and source = 'calm' order by id desc limit 1", [caseRow.id]);
  const pulse = await conn.get('select * from risk_scores where case_id = ? order by id desc limit 1', [caseRow.id]);

  const clearance = clearanceRows.length
    ? (() => {
        const items = clearanceRows.map((r) => ({
          id: r.item_id, label: r.label, clear: Boolean(r.clear), severity: r.severity, action: r.action
        }));
        const blockers = items.filter((i) => !i.clear && i.severity === 'critical');
        const warnings = items.filter((i) => !i.clear && i.severity === 'warning');
        return {
          items,
          clearCount: items.filter((i) => i.clear).length,
          total: items.length,
          blockers: blockers.length,
          warnings: warnings.length,
          cleared: blockers.length === 0,
          headline: blockers.length
            ? `${blockers.length} issue${blockers.length === 1 ? '' : 's'} must be resolved first: ${blockers.map((b) => b.label).join(', ')}`
            : warnings.length
              ? `Clear to proceed, with ${warnings.length} matter${warnings.length === 1 ? '' : 's'} to note.`
              : 'All clearance checks passed.'
        };
      })()
    : runClearanceChecks({ rorOnFile: Boolean(parcel?.ror_on_file) });

  const floor = parcel
    ? statutoryFloor({
        areaHectares: Number(parcel.record_area_hectares),
        guidanceRatePerHectare: Number(parcel.guidance_rate_per_hectare),
        landClass: parcel.land_class,
        rrEntitlement: 0
      })
    : null;

  const track = caseRow.track;
  const table = track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;
  const stage = table.get(caseRow.stage);

  const sla = slaState(
    {
      stage: caseRow.stage,
      stageEnteredAt: caseRow.stage_entered_at,
      landClass: parcel?.land_class,
      coOwnerCount: owners.length,
      hasActiveDispute: caseRow.stage === 'OBJECTION_UPHELD',
      areaHectares: Number(parcel?.record_area_hectares) || 0
    },
    now,
    track
  );

  const availableDocTypes = new Set(docs.map((d) => d.doc_type));
  const missingDocs = (stage?.requiredDocs || []).filter((d) => !availableDocTypes.has(d));

  const paid = payment && payment.status === 'paid' ? Number(payment.amount_inr) : 0;
  const outstanding = floor ? Math.max(0, floor.total - paid) : 0;

  const findings = detectFindings(
    { stage: caseRow.stage, landClass: parcel?.land_class, hasActiveDispute: caseRow.stage === 'OBJECTION_UPHELD' },
    {
      sla,
      missingDocs,
      hasAcceptedVerification: Boolean(capture && capture.status === 'verified'),
      discrepancies: discrepancies.map((d) => ({ type: d.type, detail: d.detail, severity: d.severity })),
      clearance,
      payment: payment ? { status: payment.status, failureReason: payment.failure_reason } : null,
      outstanding,
      daysSinceActivity: Math.round((now - Date.parse(caseRow.updated_at || caseRow.stage_entered_at)) / 86400000)
    }
  );

  return {
    caseRow, parcel, village, owners, docs, capture, discrepancies, clearance,
    payment, calm, pulse, floor, sla, missingDocs, findings, outstanding, stage,
    progress: progressOf({ stage: caseRow.stage }, track)
  };
}

/**
 * The citizen-facing projection.
 *
 * Deliberately not the officer view with fields hidden: a landholder needs plain
 * language, what happens next, and one clear action. Stage codes never appear.
 */
export function citizenView(ctx) {
  const { caseRow, parcel, village, capture, discrepancies, floor, payment, calm } = ctx;
  const table = caseRow.track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;
  const stage = table.get(caseRow.stage);
  const steps = (caseRow.track === 'purchase' ? PURCHASE_STAGES : STAGES).map((s) => ({
    id: s.id,
    label: s.short,
    explanation: s.citizenExplanation,
    done: s.order < (stage?.order ?? 0),
    current: s.id === caseRow.stage,
    pending: s.order > (stage?.order ?? 0)
  }));

  const needsAction = [];
  if (ctx.owners.some((o) => o.consent_state === 'pending')) {
    needsAction.push({
      id: 'consent',
      title: 'Your consent is needed',
      body: 'Please confirm that you agree to the offer, or file an objection if you do not. Nothing moves forward until you do.',
      action: 'Give consent or object'
    });
  }
  if (discrepancies.some((d) => d.type === 'AREA_MISMATCH')) {
    needsAction.push({
      id: 'area',
      title: 'The measured area differs from your record',
      body: 'A field officer will re-check the boundary. You do not need to do anything yet, and you will be told the outcome.',
      action: null
    });
  }

  return {
    // The case id must travel with the citizen projection so the consent and
    // objection actions can address the right case. An earlier build omitted it,
    // which made the citizen's "I agree / I object" buttons unable to reach the
    // consent endpoint.
    id: caseRow.id,
    caseNo: caseRow.case_no,
    track: caseRow.track,
    stage: caseRow.stage,
    stageLabel: stage?.short ?? caseRow.stage,
    whatThisMeans: stage?.citizenExplanation ?? '',
    steps,
    progress: ctx.progress,
    parcel: parcel
      ? {
          surveyNo: parcel.survey_no,
          village: village?.name,
          taluka: village?.taluka,
          recordAreaHectares: Number(parcel.record_area_hectares),
          landClass: parcel.land_class,
          geometry: jparse(parcel.geometry),
          surveyedAreaHectares: capture ? Number(capture.surveyed_area_hectares) : null,
          surveyStatus: capture?.status ?? null
        }
      : null,
    compensation: floor
      ? {
          statutoryFloorINR: floor.total,
          statutoryFloorFormatted: formatINRFull(floor.total),
          explanation: floor.basis,
          breakdown: {
            marketValue: floor.marketValue,
            solatium: floor.solatium,
            rrEntitlement: floor.rrEntitlement
          },
          estimate: calm
            ? {
                amountINR: Number(calm.amount_inr),
                lowINR: Number(calm.amount_low_inr),
                highINR: Number(calm.amount_high_inr),
                factors: jparse(calm.factors, []),
                label: 'Demonstration estimate from weighted factors, not a trained valuation model.'
              }
            : null
        }
      : null,
    payment: payment
      ? {
          status: payment.status,
          amountINR: Number(payment.amount_inr),
          reference: payment.reference,
          failureReason: payment.failure_reason
        }
      : null,
    needsAction,
    notifications: ctx.notifications ?? []
  };
}

export { ROLES, can, STAGE_BY_ID, PURCHASE_STAGE_BY_ID, DOC_TYPE_BY_ID, validateTransition };
