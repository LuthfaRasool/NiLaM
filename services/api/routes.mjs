/**
 * Domain routes: cases, queues, workflow transitions, field verification,
 * documents, notifications, dashboards and the CALM/PULSE surfaces.
 *
 * Mounted onto the app in `server.mjs`. Every route declares the permission it
 * requires; nothing is reachable without one.
 */

import { db } from '../../db/index.mjs';
import {
  STAGE_BY_ID, PURCHASE_STAGE_BY_ID, ROLES, can, validateTransition,
  slaState, statutoryFloor, runClearanceChecks, formatINR, formatINRFull,
  OFFICER_DESIGNATIONS, DOC_TYPE_BY_ID
} from '../../packages/domain/acquisition.mjs';
import { sha256 } from '../../packages/crypto/index.mjs';
import * as G from '../../packages/geometry/index.mjs';
import { adapters, integrationStatus } from './adapters.mjs';
import {
  calmEstimate, pulseScore, parcelInputFromRow, pulseInputFromContext, MODEL_VERSION
} from '../ml/index.mjs';
import { requirePermission, buildCaseContext, citizenView, appendLedger, nowIso as _nowIso, jparse as _jparse } from './shared.mjs';

const A = adapters();
const nowIso = () => new Date().toISOString();
const jparse = (v, fallback = null) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

/**
 * The queue a role lands on.
 *
 * Officer queries are scoped by designation, which is what makes the MIS
 * role-specific rather than one dashboard with different labels:
 *   sub_registrar → purchase cases in scrutiny
 *   lao           → acquisition cases in the stages the LAO owns
 *   collector     → approvals pending and at-risk acquisition cases
 *   treasury      → payments due or failed
 * Every queue is ordered exception-first, then by SLA utilisation.
 */
export function queueFor(user) {
  const base = `
    select c.id, c.case_no, c.stage, c.stage_entered_at, c.track, c.priority, c.assigned_to,
           p.survey_no, p.record_area_hectares, p.land_class,
           v.name as village_name, v.taluka,
           (select owner_name from parcel_owners o where o.parcel_id = p.id order by o.id limit 1) as owner_name,
           (select count(*) from parcel_owners o where o.parcel_id = p.id) as owner_count,
           (select count(*) from discrepancies d where d.case_id = c.id and d.severity = 'critical') as critical_findings,
           (select count(*) from clearance_checks cc where cc.case_id = c.id and cc.clear = 0 and cc.severity = 'critical') as clearance_blockers,
           (select status from field_captures fc where fc.case_id = c.id order by fc.id desc limit 1) as capture_status,
           (select status from payments pay where pay.case_id = c.id order by pay.id desc limit 1) as payment_status,
           (select status from payments pay where pay.case_id = c.id order by pay.id desc limit 1) as _pay
    from cases c
    join parcels p on p.id = c.parcel_id
    left join villages v on v.id = p.village_id
  `;

  if (user.role === 'field_verifier') {
    return { sql: `${base} where c.assigned_to = ? and c.track = 'acquisition'`, params: [user.id] };
  }
  if (user.role === 'officer' && user.designation === 'sub_registrar') {
    return { sql: `${base} where c.track = 'purchase'`, params: [] };
  }
  if (user.role === 'officer' && user.designation === 'treasury') {
    return { sql: `${base} where c.stage in ('COMPENSATION_PAID','AWARD_APPROVED')`, params: [] };
  }
  if (user.role === 'officer' && user.designation === 'collector') {
    return { sql: `${base} where c.track = 'acquisition' and (c.stage in ('AWARD_APPROVED','OBJECTION_UPHELD','AWARD_DRAFTED') or c.priority = 'high')`, params: [] };
  }
  if (user.role === 'officer') {
    return { sql: `${base} where c.track = 'acquisition' and c.stage not in ('POSSESSION_TAKEN')`, params: [] };
  }
  if (user.role === 'government') {
    return { sql: `${base} where c.track = 'acquisition'`, params: [] };
  }
  // auditor: everything, read-only
  return { sql: base, params: [] };
}

export function registerRoutes(app) {
  /* ---------------------------------------------------------------- *
   * Officer queue — the role-specific MIS home
   * ---------------------------------------------------------------- */

  app.get('/api/queue', requirePermission('case.read.queue'), async (req, res, next) => {
    try {
      const conn = await db();
      const { sql, params } = queueFor(req.user);
      const rows = await conn.all(sql, params);
      const now = Date.now();

      const items = rows.map((r) => {
        const sla = slaState(
          {
            stage: r.stage,
            stageEnteredAt: r.stage_entered_at,
            landClass: r.land_class,
            coOwnerCount: r.owner_count,
            areaHectares: Number(r.record_area_hectares) || 0
          },
          now,
          r.track
        );
        const table = r.track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;
        // Exception-first ranking, the brief's "what needs my action".
        const exception =
          (r.clearance_blockers > 0 ? 5 : 0) +
          (Number(r.critical_findings) > 0 ? 4 : 0) +
          (r.payment_status === 'failed' ? 6 : 0) +
          (sla.verdict === 'breached' ? 3 : sla.verdict === 'at_risk' ? 2 : 0);
        return {
          caseId: r.id,
          caseNo: r.case_no,
          track: r.track,
          stage: r.stage,
          stageLabel: table.get(r.stage)?.short ?? r.stage,
          surveyNo: r.survey_no,
          village: r.village_name,
          taluka: r.taluka,
          ownerName: r.owner_name,
          ownerCount: r.owner_count,
          areaHectares: Number(r.record_area_hectares),
          priority: r.priority,
          sla,
          clearanceBlockers: r.clearance_blockers,
          criticalFindings: Number(r.critical_findings),
          captureStatus: r.capture_status,
          paymentStatus: r.payment_status,
          exceptionScore: exception
        };
      });

      items.sort((a, b) => b.exceptionScore - a.exceptionScore || b.sla.utilisation - a.sla.utilisation);

      const needAction = items.filter((i) => i.exceptionScore > 0);
      res.json({
        role: req.user.role,
        designation: req.user.designation,
        queueLabel: OFFICER_DESIGNATIONS.find((d) => d.id === req.user.designation)?.queueLabel ?? 'Your cases',
        summary: {
          total: items.length,
          needsAction: needAction.length,
          overdue: items.filter((i) => i.sla.verdict === 'breached').length,
          atRisk: items.filter((i) => i.sla.verdict === 'at_risk').length,
          withClearanceBlockers: items.filter((i) => i.clearanceBlockers > 0).length,
          withFindings: items.filter((i) => i.criticalFindings > 0).length,
          paymentFailures: items.filter((i) => i.paymentStatus === 'failed').length
        },
        // Exception-first: what needs action, then what is urgent.
        needsAction: needAction.slice(0, 50),
        all: items.slice(0, 200),
        integrations: integrationStatus()
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Case detail — the core officer workspace
   * ---------------------------------------------------------------- */

  app.get('/api/cases/:id', requirePermission('case.read'), async (req, res, next) => {
    try {
      const conn = await db();
      const caseRow = await conn.get('select * from cases where id = ?', [Number(req.params.id)]);
      if (!caseRow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such case.' } });

      const ctx = await buildCaseContext(conn, caseRow);
      const events = await conn.all(
        'select * from case_events where case_id = ? order by at',
        [caseRow.id]
      );
      const corners = ctx.capture
        ? await conn.all('select * from field_corners where capture_id = ? order by corner_index', [ctx.capture.id])
        : [];
      const notifications = await conn.all(
        'select * from notifications where case_id = ? order by created_at desc limit 20',
        [caseRow.id]
      );

      const table = caseRow.track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;
      const stage = table.get(caseRow.stage);

      // Which next stages this user could actually action, with the reason when
      // they cannot. The UI needs the reason, not just a disabled button.
      const nextStages = (stage?.next || []).map((to) => {
        const verdict = validateTransition({
          from: caseRow.stage,
          to,
          role: req.user.role,
          designation: req.user.designation,
          track: caseRow.track,
          docs: ctx.docs.map((d) => ({ type: d.doc_type })),
          verifications: ctx.capture ? [{ status: ctx.capture.status }] : [],
          caseRow
        });
        const target = table.get(to);
        return {
          stageId: to,
          label: target?.label,
          short: target?.short,
          legalRef: target?.legalRef,
          allowed: verdict.ok,
          reason: verdict.ok ? null : verdict.message
        };
      });

      res.json({
        case: {
          id: caseRow.id,
          caseNo: caseRow.case_no,
          track: caseRow.track,
          stage: caseRow.stage,
          stageLabel: stage?.short,
          stageLabelFull: stage?.label,
          legalRef: stage?.legalRef,
          stageEnteredAt: caseRow.stage_entered_at,
          priority: caseRow.priority,
          assignedTo: caseRow.assigned_to,
          decision: caseRow.decision,
          decisionNote: caseRow.decision_note,
          progress: ctx.progress
        },
        parcel: ctx.parcel
          ? {
              id: ctx.parcel.id,
              surveyNo: ctx.parcel.survey_no,
              plotNo: ctx.parcel.plot_no,
              village: ctx.village?.name,
              taluka: ctx.village?.taluka,
              district: ctx.village?.district,
              recordAreaHectares: Number(ctx.parcel.record_area_hectares),
              notifiedAreaHectares: ctx.parcel.notified_area_hectares ? Number(ctx.parcel.notified_area_hectares) : null,
              surveyedAreaHectares: ctx.capture ? Number(ctx.capture.surveyed_area_hectares) : null,
              landClass: ctx.parcel.land_class,
              landUse: ctx.parcel.land_use,
              guidanceRate: Number(ctx.parcel.guidance_rate_per_hectare),
              irrigated: Boolean(ctx.parcel.irrigated),
              structures: ctx.parcel.structures,
              trees: ctx.parcel.trees,
              distanceToRoadM: ctx.parcel.distance_to_road_m,
              geometry: jparse(ctx.parcel.geometry),
              centroid: jparse(ctx.parcel.centroid),
              chainageStart: ctx.parcel.chainage_start_m,
              chainageEnd: ctx.parcel.chainage_end_m,
              rorYear: ctx.parcel.ror_year,
              rorOnFile: Boolean(ctx.parcel.ror_on_file)
            }
          : null,
        owners: ctx.owners.map((o) => ({
          id: o.id,
          name: o.owner_name,
          guardian: o.guardian_name,
          identityVerified: Boolean(o.identity_verified),
          identityProvider: o.identity_provider,
          isLegalHeir: Boolean(o.is_legal_heir),
          share: `${o.share_numerator}/${o.share_denominator}`,
          consentState: o.consent_state,
          consentAt: o.consent_at
        })),
        sla: ctx.sla,
        clearance: ctx.clearance,
        discrepancies: ctx.discrepancies.map((d) => ({
          id: d.id,
          type: d.type,
          severity: d.severity,
          detail: d.detail,
          measured: d.measured_value !== null ? Number(d.measured_value) : null,
          expected: d.expected_value !== null ? Number(d.expected_value) : null,
          deltaRatio: d.delta_ratio !== null ? Number(d.delta_ratio) : null
        })),
        capture: ctx.capture
          ? {
              id: ctx.capture.id,
              ref: ctx.capture.capture_ref,
              status: ctx.capture.status,
              surveyedAreaHectares: Number(ctx.capture.surveyed_area_hectares),
              clientAreaHectares: ctx.capture.client_area_hectares ? Number(ctx.capture.client_area_hectares) : null,
              cornerCount: ctx.capture.corner_count,
              gpsFlagged: Boolean(ctx.capture.gps_flagged),
              capturedAt: ctx.capture.captured_at,
              syncedOffline: Boolean(ctx.capture.synced_offline),
              polygon: jparse(ctx.capture.polygon),
              corners: corners.map((c) => ({
                index: c.corner_index,
                lat: Number(c.latitude),
                lon: Number(c.longitude),
                accuracyM: c.accuracy_m !== null ? Number(c.accuracy_m) : null,
                headingDeg: c.heading_deg !== null ? Number(c.heading_deg) : null,
                photoHash: c.photo_hash,
                capturedAt: c.captured_at,
                mockLocation: Boolean(c.is_mock_location)
              }))
            }
          : null,
        documents: ctx.docs.map((d) => ({
          id: d.id,
          type: d.doc_type,
          typeLabel: DOC_TYPE_BY_ID.get(d.doc_type)?.label ?? d.doc_type,
          title: d.title,
          revision: d.revision,
          contentHash: d.content_hash,
          parentHash: d.parent_hash,
          issuedToVault: Boolean(d.issued_to_vault),
          vaultReference: d.vault_reference,
          createdAt: d.created_at
        })),
        compensation: {
          statutoryFloor: ctx.floor,
          calm: ctx.calm
            ? {
                amountINR: Number(ctx.calm.amount_inr),
                lowINR: Number(ctx.calm.amount_low_inr),
                highINR: Number(ctx.calm.amount_high_inr),
                modelVersion: ctx.calm.model_version,
                belowFloor: Boolean(ctx.calm.below_floor),
                factors: jparse(ctx.calm.factors, []),
                label: 'Demonstration model. Weighted factors, not a trained valuation model.'
              }
            : null,
          payment: ctx.payment
            ? {
                amountINR: Number(ctx.payment.amount_inr),
                status: ctx.payment.status,
                reference: ctx.payment.reference,
                failureReason: ctx.payment.failure_reason
              }
            : null,
          outstanding: ctx.outstanding
        },
        pulse: ctx.pulse
          ? {
              probability: Number(ctx.pulse.probability),
              tier: ctx.pulse.tier,
              reasons: jparse(ctx.pulse.reasons, []),
              recommendedAction: ctx.pulse.recommended_action,
              modelVersion: ctx.pulse.model_version,
              ruleBaseline: ctx.pulse.rule_baseline_score,
              label: 'Demonstration model. Weighted factors, not a trained valuation model.'
            }
          : null,
        findings: ctx.findings,
        missingDocuments: ctx.missingDocs.map((d) => ({ id: d, label: DOC_TYPE_BY_ID.get(d)?.label ?? d })),
        nextStages,
        events: events.map((e) => ({
          id: e.id,
          at: e.at,
          action: e.action,
          from: e.from_stage,
          to: e.to_stage,
          actor: e.actor_name,
          actorRole: e.actor_role,
          reason: e.reason
        })),
        notifications: notifications.map((n) => ({
          id: n.id, kind: n.kind, title: n.title, body: n.body,
          needsAction: Boolean(n.needs_action), nextStep: n.next_step, at: n.created_at
        })),
        integrations: integrationStatus()
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Workflow transition
   * ---------------------------------------------------------------- */

  app.post('/api/cases/:id/transition', requirePermission('case.transition'), async (req, res, next) => {
    try {
      const conn = await db();
      const caseRow = await conn.get('select * from cases where id = ?', [Number(req.params.id)]);
      if (!caseRow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such case.' } });

      const to = String(req.body?.to || '');
      const reason = String(req.body?.reason || '').trim();
      if (reason.length < 10) {
        return res.status(400).json({
          error: { code: 'REASON_REQUIRED', message: 'Record a reason of at least 10 characters for the case file.' }
        });
      }

      const ctx = await buildCaseContext(conn, caseRow);
      const verdict = validateTransition({
        from: caseRow.stage,
        to,
        role: req.user.role,
        designation: req.user.designation,
        track: caseRow.track,
        docs: ctx.docs.map((d) => ({ type: d.doc_type })),
        verifications: ctx.capture ? [{ status: ctx.capture.status }] : [],
        caseRow
      });

      if (!verdict.ok) {
        return res.status(409).json({
          error: { code: verdict.code, message: verdict.message, details: verdict.details ?? null }
        });
      }

      const at = nowIso();
      await conn.transaction(async (tx) => {
        await tx.run('update cases set stage = ?, stage_entered_at = ?, updated_at = ? where id = ?', [
          to, at, at, caseRow.id
        ]);
        await tx.run(
          `insert into case_events (case_id, at, action, from_stage, to_stage, actor_id, actor_name, actor_role, reason, detail)
           values (?, ?, 'STAGE_ENTERED', ?, ?, ?, ?, ?, ?, ?)`,
          [caseRow.id, at, caseRow.stage, to, req.user.id, req.user.name, req.user.role, reason,
           JSON.stringify({ legalRef: verdict.stage.legalRef })]
        );
      });

      const entry = await appendLedger(conn, {
        actor: req.user,
        action: 'CASE_STAGE_ENTERED',
        subject: `case:${caseRow.id}`,
        detail: { from: caseRow.stage, to, legalRef: verdict.stage.legalRef, reason }
      });

      // Tell the citizen, in plain language, what changed and what is next.
      const owners = await conn.all('select * from parcel_owners where parcel_id = ?', [caseRow.parcel_id]);
      for (const owner of owners) {
        if (!owner.user_id) continue;
        await conn.run(
          `insert into notifications (user_id, case_id, kind, title, body, needs_action, next_step, created_at)
           values (?, ?, 'status', ?, ?, 0, ?, ?)`,
          [
            owner.user_id, caseRow.id,
            `Case ${caseRow.case_no} has moved forward`,
            verdict.stage.citizenExplanation ?? `The case is now at "${verdict.stage.short}".`,
            0, 'Open the case to see the details.', at
          ]
        );
      }

      res.json({
        ok: true,
        caseId: caseRow.id,
        from: caseRow.stage,
        to,
        stage: { id: verdict.stage.id, label: verdict.stage.label, legalRef: verdict.stage.legalRef },
        ledgerEntry: { seq: entry.seq, hash: entry.hash }
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Field verification — server-authoritative discrepancy detection
   * ---------------------------------------------------------------- */

  /**
   * Detects discrepancies from a submitted corner ring.
   *
   * The client's own area is accepted for comparison and never used for a
   * decision. Everything below is recomputed from the corner coordinates on the
   * server, which is what the brief requires ("never trust client flags").
   */
  async function detectDiscrepancies(conn, { caseRow, parcel, corners, clientArea }) {
    const tolerance = Number(process.env.NILAM_AREA_TOLERANCE || 0.05);
    const accuracyMax = Number(process.env.NILAM_ACCURACY_MAX_M || 15);
    const found = [];

    const ring = [...corners.map((c) => [c.lon, c.lat]), [corners[0].lon, corners[0].lat]];
    const polygon = { type: 'Polygon', coordinates: [ring] };
    const surveyedArea = G.geometryAreaHectares(polygon);

    const recordArea = Number(parcel.record_area_hectares);
    const notifiedArea = parcel.notified_area_hectares ? Number(parcel.notified_area_hectares) : recordArea;

    for (const [against, expected] of [['record', recordArea], ['notified', notifiedArea]]) {
      const delta = (surveyedArea - expected) / expected;
      if (Math.abs(delta) > tolerance) {
        found.push({
          type: 'AREA_MISMATCH',
          severity: 'critical',
          detail: `The surveyed area is ${(Math.abs(delta) * 100).toFixed(1)}% ${delta > 0 ? 'larger' : 'smaller'} than the ${against} area (tolerance ±${(tolerance * 100).toFixed(0)}%).`,
          measured: surveyedArea, expected, delta
        });
        break;
      }
    }

    const outside = corners.filter((c) => !G.geometryContains(jparse(parcel.geometry), [c.lon, c.lat]));
    if (outside.length) {
      const centre = G.geometryCentroid(jparse(parcel.geometry));
      const furthest = Math.max(...outside.map((c) => G.haversineM([c.lon, c.lat], centre)));
      found.push({
        type: 'CORNER_OUTSIDE_BOUNDARY',
        severity: 'critical',
        detail: `${outside.length} of ${corners.length} corners fall outside the notified boundary (furthest ${Math.round(furthest)} m from the parcel centre).`,
        measured: outside.length, expected: 0, delta: null
      });
    }

    const unique = new Set(corners.map((c) => `${c.lon},${c.lat}`));
    const worst = Math.max(...corners.map((c) => c.accuracy ?? 0));
    const reasons = [];
    if (unique.size < corners.length) reasons.push(`${corners.length - unique.size} corner(s) share identical coordinates`);
    if (corners.some((c) => c.mockLocation)) reasons.push('the device reported a mock location');
    if (worst > accuracyMax) reasons.push(`accuracy reached ±${worst} m against a limit of ±${accuracyMax} m`);
    if (reasons.length) {
      found.push({
        type: 'SUSPICIOUS_GPS', severity: 'warning',
        detail: `The capture location is not reliable: ${reasons.join('; ')}.`,
        measured: worst, expected: accuracyMax, delta: null
      });
    }

    // Overlap with any other parcel, measured as a share of the surveyed area so
    // a shared boundary is not mistaken for an overlap.
    const others = await conn.all('select id, survey_no, geometry, village_id from parcels where id != ?', [parcel.id]);
    const surveyBBox = G.geometryBBox(polygon);
    let best = null;
    for (const other of others) {
      const geom = jparse(other.geometry);
      if (!geom) continue;
      if (!G.bboxIntersects(surveyBBox, G.geometryBBox(geom))) continue;
      const steps = 40;
      let both = 0;
      let inside = 0;
      for (let i = 0; i < steps; i += 1) {
        for (let j = 0; j < steps; j += 1) {
          const x = surveyBBox[0] + ((surveyBBox[2] - surveyBBox[0]) * (i + 0.5)) / steps;
          const y = surveyBBox[1] + ((surveyBBox[3] - surveyBBox[1]) * (j + 0.5)) / steps;
          if (!G.geometryContains(polygon, [x, y])) continue;
          inside += 1;
          if (G.geometryContains(geom, [x, y])) both += 1;
        }
      }
      if (!inside) continue;
      const ratio = both / inside;
      if (!best || ratio > best.ratio) best = { ratio, other };
    }
    if (best && best.ratio > 0.02) {
      found.push({
        type: 'NEIGHBOUR_OVERLAP', severity: 'critical',
        detail: `The surveyed polygon overlaps Survey No. ${best.other.survey_no} across about ${(best.ratio * 100).toFixed(1)}% of its area.`,
        measured: Math.round(best.ratio * 1000) / 1000, expected: 0, delta: best.ratio
      });
    }

    return { found, surveyedArea, polygon, clientArea: clientArea ?? null };
  }

  app.post('/api/cases/:id/capture', requirePermission('capture.submit'), async (req, res, next) => {
    try {
      const conn = await db();
      const caseRow = await conn.get('select * from cases where id = ?', [Number(req.params.id)]);
      if (!caseRow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such case.' } });
      const parcel = await conn.get('select * from parcels where id = ?', [caseRow.parcel_id]);

      const corners = Array.isArray(req.body?.corners) ? req.body.corners : [];
      if (corners.length < 3) {
        return res.status(400).json({
          error: {
            code: 'TOO_FEW_CORNERS',
            message: `At least 3 corners are required to form a parcel boundary; ${corners.length} received.`
          }
        });
      }

      const accuracyMax = Number(process.env.NILAM_ACCURACY_MAX_M || 15);
      const normalised = corners.map((c, i) => ({
        index: i + 1,
        lat: Number(c.lat),
        lon: Number(c.lon),
        accuracy: c.accuracyM !== undefined ? Number(c.accuracyM) : (c.accuracy !== undefined ? Number(c.accuracy) : null),
        heading: c.headingDeg !== undefined ? Number(c.headingDeg) : null,
        altitude: c.altitudeM !== undefined ? Number(c.altitudeM) : null,
        photoHash: c.photoHash ? String(c.photoHash) : null,
        capturedAt: c.capturedAt ? String(c.capturedAt) : nowIso(),
        mockLocation: Boolean(c.mockLocation)
      }));

      for (const c of normalised) {
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) {
          return res.status(400).json({ error: { code: 'BAD_COORDINATES', message: `Corner ${c.index} has no usable coordinates.` } });
        }
        // The accuracy gate is enforced server-side as well as on the handset.
        if (c.accuracy !== null && c.accuracy > accuracyMax) {
          return res.status(400).json({
            error: {
              code: 'ACCURACY_TOO_POOR',
              message: `Corner ${c.index} was recorded with ±${c.accuracy} m accuracy, which is worse than the ±${accuracyMax} m limit. Move to open ground and capture it again.`
            }
          });
        }
      }

      const { found, surveyedArea, polygon, clientArea } = await detectDiscrepancies(conn, {
        caseRow, parcel, corners: normalised, clientArea: req.body?.clientAreaHectares ?? null
      });

      const flagged = found.some((d) => d.severity === 'critical');
      const captureRef = `CAP-${Date.now().toString(36).toUpperCase()}`;
      const at = nowIso();

      const captureId = await conn.transaction(async (tx) => {
        const row = await tx.run(
          `insert into field_captures (capture_ref, case_id, parcel_id, verifier_id, verifier_name, status,
              surveyed_area_hectares, client_area_hectares, polygon, corner_count, gps_flagged,
              captured_at, synced_at, synced_offline, note, device)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            captureRef, caseRow.id, parcel.id, req.user.id, req.user.name,
            flagged ? 'flagged' : 'verified',
            Math.round(surveyedArea * 10000) / 10000,
            clientArea === null ? null : Math.round(Number(clientArea) * 10000) / 10000,
            JSON.stringify(polygon), normalised.length,
            found.some((d) => d.type === 'SUSPICIOUS_GPS') ? 1 : 0,
            at, at, req.body?.offline ? 1 : 0,
            req.body?.note ? String(req.body.note).slice(0, 1000) : null,
            req.body?.device ? String(req.body.device).slice(0, 120) : null
          ]
        );
        const id = row.lastInsertRowid;
        for (const c of normalised) {
          await tx.run(
            `insert into field_corners (capture_id, corner_index, latitude, longitude, accuracy_m, heading_deg, altitude_m, point, photo_hash, captured_at, is_mock_location)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, c.index, c.lat, c.lon, c.accuracy, c.heading, c.altitude,
             JSON.stringify([c.lon, c.lat]), c.photoHash, c.capturedAt, c.mockLocation ? 1 : 0]
          );
        }
        for (const d of found) {
          await tx.run(
            `insert into discrepancies (case_id, capture_id, type, severity, detail, measured_value, expected_value, delta_ratio, detected_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [caseRow.id, id, d.type, d.severity, d.detail, d.measured ?? null, d.expected ?? null, d.delta ?? null, at]
          );
        }
        await tx.run('update cases set area_surveyed_hectares = ?, updated_at = ? where id = ?', [
          Math.round(surveyedArea * 10000) / 10000, at, caseRow.id
        ]);
        await tx.run(
          "update field_assignments set status = 'submitted', completed_at = ? where case_id = ? and status != 'submitted'",
          [at, caseRow.id]
        );
        return id;
      });

      const entry = await appendLedger(conn, {
        actor: req.user,
        action: flagged ? 'FIELD_CAPTURE_FLAGGED' : 'FIELD_CAPTURE_VERIFIED',
        subject: `case:${caseRow.id}`,
        detail: {
          captureId, captureRef,
          surveyedAreaHectares: Math.round(surveyedArea * 10000) / 10000,
          recordAreaHectares: Number(parcel.record_area_hectares),
          clientClaimedArea: clientArea,
          cornerCount: normalised.length,
          discrepancies: found.map((d) => ({ type: d.type, severity: d.severity }))
        }
      });

      res.status(201).json({
        ok: true,
        captureId,
        captureRef,
        status: flagged ? 'flagged' : 'verified',
        // Stated explicitly because the brief requires it: a flagged capture is
        // stored, not discarded, and it is evidence rather than an error.
        stored: true,
        surveyedAreaHectares: Math.round(surveyedArea * 10000) / 10000,
        recordAreaHectares: Number(parcel.record_area_hectares),
        clientClaimedAreaHectares: clientArea,
        discrepancies: found,
        message: flagged
          ? `Capture recorded and flagged with ${found.length} issue(s). Review it before the award is drafted.`
          : 'Capture recorded and verified. The surveyed area is within tolerance of the record.',
        ledgerEntry: { seq: entry.seq, hash: entry.hash }
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Documents and vault
   * ---------------------------------------------------------------- */

  app.get('/api/cases/:id/documents', requirePermission('document.read'), async (req, res, next) => {
    try {
      const conn = await db();
      const docs = await conn.all('select * from documents where case_id = ? order by id', [Number(req.params.id)]);
      const out = [];
      for (const d of docs) {
        const revisions = await conn.all(
          'select revision, content_hash, parent_hash, byte_size, author_name, created_at from document_revisions where document_id = ? order by revision',
          [d.id]
        );
        out.push({
          id: d.id,
          type: d.doc_type,
          typeLabel: DOC_TYPE_BY_ID.get(d.doc_type)?.label ?? d.doc_type,
          title: d.title,
          currentRevision: d.current_revision,
          issuedToVault: Boolean(d.issued_to_vault),
          vaultReference: d.vault_reference,
          revisions: revisions.map((r) => ({
            revision: r.revision,
            contentHash: r.content_hash,
            parentHash: r.parent_hash,
            byteSize: r.byte_size,
            author: r.author_name,
            createdAt: r.created_at
          }))
        });
      }
      res.json({ caseId: Number(req.params.id), documents: out });
    } catch (err) {
      next(err);
    }
  });

  /** Re-walks the version chain and recomputes each digest: tamper detection. */
  app.get('/api/documents/:id/verify', requirePermission('document.read'), async (req, res, next) => {
    try {
      const conn = await db();
      const doc = await conn.get('select * from documents where id = ?', [Number(req.params.id)]);
      if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such document.' } });
      const revisions = await conn.all(
        'select * from document_revisions where document_id = ? order by revision',
        [doc.id]
      );
      const steps = [];
      let prev = null;
      let intact = true;
      for (const r of revisions) {
        const recomputed = sha256(Buffer.from(r.body, 'utf8'));
        const contentOk = recomputed === r.content_hash;
        const linkOk = prev === null ? r.parent_hash === null : r.parent_hash === prev.content_hash;
        if (!contentOk || !linkOk) intact = false;
        steps.push({
          revision: r.revision,
          recorded: r.content_hash,
          recomputed,
          contentOk,
          linkOk,
          expectedParent: prev ? prev.content_hash : null,
          author: r.author_name,
          createdAt: r.created_at
        });
        prev = r;
      }
      res.status(intact ? 200 : 409).json({
        documentId: doc.id,
        title: doc.title,
        type: doc.doc_type,
        vaultReference: doc.vault_reference,
        revisions: revisions.length,
        intact,
        verdict: intact
          ? 'Intact: every revision matches its recorded digest and links to its predecessor.'
          : 'INTEGRITY FAILURE: a stored revision no longer matches its recorded digest, or the chain is broken.',
        steps
      });
    } catch (err) {
      next(err);
    }
  });

  /** Issues the current revision into the vault abstraction, with a version trail. */
  app.post('/api/documents/:id/issue', requirePermission('document.issue'), async (req, res, next) => {
    try {
      const conn = await db();
      const doc = await conn.get('select * from documents where id = ?', [Number(req.params.id)]);
      if (!doc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such document.' } });
      const rev = await conn.get(
        'select * from document_revisions where document_id = ? order by revision desc limit 1',
        [doc.id]
      );
      const issued = await A.vault.issue({
        documentId: doc.id,
        title: doc.title,
        revision: rev?.revision ?? 1,
        body: rev?.body ?? '',
        issuedBy: req.user.name,
        issuedTo: req.body?.issuedTo ?? null
      });
      await conn.run('update documents set issued_to_vault = 1, vault_reference = ? where id = ?', [
        issued.vaultReference, doc.id
      ]);
      await appendLedger(conn, {
        actor: req.user,
        action: 'DOCUMENT_ISSUED_TO_VAULT',
        subject: `document:${doc.id}`,
        detail: { vaultReference: issued.vaultReference, revision: issued.revision, demonstration: true }
      });
      res.json({ ok: true, issued, integrations: integrationStatus() });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Notifications
   * ---------------------------------------------------------------- */

  app.get('/api/notifications', requirePermission('notification.read.own'), async (req, res, next) => {
    try {
      const conn = await db();
      const rows = await conn.all('select * from notifications where user_id = ? order by created_at desc limit 50', [req.user.id]);
      res.json({
        notifications: rows.map((n) => ({
          id: n.id,
          caseId: n.case_id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          // The brief's rule: say what happened, whether I must act, and what next.
          needsAction: Boolean(n.needs_action),
          nextStep: n.next_step,
          readAt: n.read_at,
          at: n.created_at
        })),
        unread: rows.filter((n) => !n.read_at).length,
        needingAction: rows.filter((n) => n.needs_action && !n.read_at).length
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Citizen surfaces
   * ---------------------------------------------------------------- */

  app.get('/api/my/cases', requirePermission('case.read.own'), async (req, res, next) => {
    try {
      const conn = await db();
      const rows = await conn.all(
        `select c.id from cases c
         join parcel_owners o on o.parcel_id = c.parcel_id
         where o.user_id = ? group by c.id order by c.updated_at desc`,
        [req.user.id]
      );
      const out = [];
      for (const r of rows) {
        const caseRow = await conn.get('select * from cases where id = ?', [r.id]);
        const ctx = await buildCaseContext(conn, caseRow);
        const notifications = await conn.all('select * from notifications where case_id = ? order by created_at desc limit 5', [r.id]);
        out.push(citizenView({ ...ctx, notifications }));
      }
      res.json({ cases: out });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/my/cases/:id', requirePermission('case.read.own'), async (req, res, next) => {
    try {
      const conn = await db();
      const caseRow = await conn.get('select * from cases where id = ?', [Number(req.params.id)]);
      if (!caseRow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such case.' } });
      const owners = await conn.all('select * from parcel_owners where parcel_id = ?', [caseRow.parcel_id]);
      // A citizen may only see a case in which they are a recorded owner.
      if (!owners.some((o) => o.user_id === req.user.id) && req.user.role !== 'officer') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This case does not belong to you.' } });
      }
      const ctx = await buildCaseContext(conn, caseRow);
      const notifications = await conn.all('select * from notifications where case_id = ? order by created_at desc limit 10', [caseRow.id]);
      res.json({ case: citizenView({ ...ctx, notifications }) });
    } catch (err) {
      next(err);
    }
  });

  /** Consent or objection, from the landholder. */
  app.post('/api/my/cases/:id/consent', requirePermission('consent.submit.own'), async (req, res, next) => {
    try {
      const conn = await db();
      const caseRow = await conn.get('select * from cases where id = ?', [Number(req.params.id)]);
      if (!caseRow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such case.' } });
      const owners = await conn.all('select * from parcel_owners where parcel_id = ?', [caseRow.parcel_id]);
      const mine = owners.find((o) => o.user_id === req.user.id);
      if (!mine) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This case does not belong to you.' } });

      const decision = String(req.body?.decision || '');
      if (!['consented', 'objected'].includes(decision)) {
        return res.status(400).json({
          error: { code: 'BAD_DECISION', message: 'Choose either to give consent or to file an objection.' }
        });
      }
      const note = String(req.body?.note || '').slice(0, 2000);
      if (decision === 'objected' && note.trim().length < 10) {
        return res.status(400).json({
          error: { code: 'REASON_REQUIRED', message: 'Please describe the ground for your objection in at least 10 characters.' }
        });
      }

      const at = nowIso();
      await conn.run('update parcel_owners set consent_state = ?, consent_at = ?, consent_note = ? where id = ?', [
        decision, at, note || null, mine.id
      ]);

      if (decision === 'objected') {
        // An objection is a statutory step, so it is recorded as a case event and
        // flagged for the officer rather than silently stored on the owner row.
        await conn.run(
          `insert into case_events (case_id, at, action, from_stage, to_stage, actor_id, actor_name, actor_role, reason, detail)
           values (?, ?, 'OBJECTION_FILED', ?, ?, ?, ?, 'citizen', ?, ?)`,
          [caseRow.id, at, caseRow.stage, caseRow.stage, req.user.id, req.user.name, note,
           JSON.stringify({ ownerId: mine.id })]
        );
      }

      const entry = await appendLedger(conn, {
        actor: req.user,
        action: decision === 'objected' ? 'OBJECTION_FILED_BY_OWNER' : 'CONSENT_GIVEN_BY_OWNER',
        subject: `case:${caseRow.id}`,
        detail: { ownerId: mine.id, decision, note: note || null }
      });

      res.json({
        ok: true,
        decision,
        at,
        message: decision === 'consented'
          ? 'Thank you. Your consent has been recorded on the case file.'
          : 'Your objection has been recorded. The Collector will hear you and you will be told the date.',
        ledgerEntry: { seq: entry.seq, hash: entry.hash }
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Purchase request wizard
   * ---------------------------------------------------------------- */

  app.post('/api/requests', requirePermission('request.create'), async (req, res, next) => {
    try {
      const conn = await db();
      const { parcelId, intendedUse, offerAmountINR, sellerName, sellerMobile } = req.body || {};
      const parcel = await conn.get('select * from parcels where id = ?', [Number(parcelId)]);
      if (!parcel) return res.status(400).json({ error: { code: 'BAD_PARCEL', message: 'Choose a parcel for your request.' } });

      const purchaseProject = await conn.get("select * from projects where track = 'purchase' limit 1");
      const reference = `NILAM/PUR/${new Date().getFullYear()}/${Math.floor(Math.random() * 9000 + 1000)}`;
      const at = nowIso();

      const caseId = await conn.transaction(async (tx) => {
        const req = await tx.run(
          `insert into requests (reference, track, requester_id, parcel_id, project_id, intended_use, offer_amount_inr, status, current_stage, created_at, updated_at)
           values (?, 'purchase', ?, ?, ?, ?, ?, 'in_progress', 'REQUEST_SUBMITTED', ?, ?)`,
          [reference, req.user.id, parcel.id, purchaseProject?.id ?? null, intendedUse ?? null,
           offerAmountINR ?? null, at, at]
        );
        const owner = await tx.run(
          `insert into parcel_owners (parcel_id, owner_name, identity_provider, identity_token, identity_verified, contact_phone, consent_state, created_at)
           values (?, ?, 'digilocker-demo', null, 0, ?, 'pending', ?)`,
          [parcel.id, sellerName || 'Seller (to be verified)', sellerMobile || null, at]
        );
        const c = await tx.run(
          `insert into cases (case_no, track, project_id, parcel_id, owner_id, request_id, stage, stage_entered_at, priority, assigned_to, assigned_at, area_requested_hectares, created_at, updated_at)
           values (?, 'purchase', ?, ?, ?, ?, 'REQUEST_SUBMITTED', ?, 'normal', null, ?, ?, ?, ?)`,
          [
            `NILAM/PUR/${parcel.survey_no.replace('/', '-')}-${req.lastInsertRowid}`,
            purchaseProject?.id ?? null, parcel.id, owner.lastInsertRowid, req.lastInsertRowid,
            at, at, Number(parcel.record_area_hectares), at, at
          ]
        );
        await tx.run(
          `insert into case_events (case_id, at, action, from_stage, to_stage, actor_id, actor_name, actor_role, reason, detail)
           values (?, ?, 'REQUEST_SUBMITTED', null, 'REQUEST_SUBMITTED', ?, ?, 'citizen', ?, '{}')`,
          [c.lastInsertRowid, at, req.user.id, req.user.name, 'Request raised by the citizen.']
        );
        // Seed the clearance checklist so the officer sees it immediately.
        const clearance = runClearanceChecks({ coOwnerCount: 1, rorOnFile: false });
        for (const item of clearance.items) {
          await tx.run(
            `insert into clearance_checks (case_id, item_id, label, clear, severity, action, checked_at)
             values (?, ?, ?, ?, ?, ?, ?)`,
            [c.lastInsertRowid, item.id, item.label, item.clear ? 1 : 0, item.severity, item.action, at]
          );
        }
        return c.lastInsertRowid;
      });

      await conn.run(
        `insert into notifications (user_id, case_id, kind, title, body, needs_action, next_step, created_at)
         values (?, ?, 'status', ?, ?, 1, ?, ?)`,
        [req.user.id, caseId, 'Your request has been received',
         `Reference ${reference}. The next step is verifying the seller through DigiLocker.`,
         0, 'Open the case to track progress.', at]
      );

      const entry = await appendLedger(conn, {
        actor: req.user,
        action: 'PURCHASE_REQUEST_CREATED',
        subject: `case:${caseId}`,
        detail: { reference, parcelId: parcel.id, offerAmountINR: offerAmountINR ?? null }
      });

      res.status(201).json({
        ok: true,
        caseId,
        reference,
        message: `Request created. Your reference is ${reference}.`,
        ledgerEntry: { seq: entry.seq, hash: entry.hash }
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Government / agency overview
   * ---------------------------------------------------------------- */

  app.get('/api/government/overview', requirePermission('dashboard.read'), async (req, res, next) => {
    try {
      const conn = await db();
      const now = Date.now();
      const projectRows = await conn.all("select * from projects where track = 'acquisition'");
      const projects = [];

      for (const p of projectRows) {
        const cases = await conn.all(
          `select c.*, pa.record_area_hectares, pa.land_class from cases c
           join parcels pa on pa.id = c.parcel_id where c.project_id = ?`,
          [p.id]
        );
        const byStage = {};
        let payable = 0;
        let paid = 0;
        let breached = 0;
        let flagged = 0;
        let atRisk = 0;

        for (const c of cases) {
          byStage[c.stage] = (byStage[c.stage] || 0) + 1;
          const floor = statutoryFloor({
            areaHectares: Number(c.record_area_hectares),
            guidanceRatePerHectare: Number((await conn.get('select guidance_rate_per_hectare as g from parcels where id = ?', [c.parcel_id]))?.g ?? 0),
            landClass: c.land_class,
            rrEntitlement: 0
          });
          payable += floor.total;
          const pay = await conn.get('select * from payments where case_id = ? order by id desc limit 1', [c.id]);
          if (pay && pay.status === 'paid') paid += Number(pay.amount_inr);
          const sla = slaState({ stage: c.stage, stageEnteredAt: c.stage_entered_at, landClass: c.land_class, areaHectares: Number(c.record_area_hectares) }, now);
          if (sla.verdict === 'breached') breached += 1;
          if (sla.verdict === 'at_risk') atRisk += 1;
          const cap = await conn.get('select status from field_captures where case_id = ? order by id desc limit 1', [c.id]);
          if (cap?.status === 'flagged') flagged += 1;
        }

        projects.push({
          id: p.id,
          code: p.code,
          name: p.name,
          agency: p.agency,
          district: p.district,
          status: p.status,
          budgetINR: p.budget_inr ? Number(p.budget_inr) : null,
          parcelCount: cases.length,
          byStage,
          payableINR: payable,
          paidINR: paid,
          /* "Projected delays" the brief asks the agency to see. */
          atRiskCases: atRisk,
          breachedCases: breached,
          flaggedCaptures: flagged,
          corridor: jparse(p.corridor)
        });
      }

      res.json({
        projects,
        totals: {
          parcels: projects.reduce((s, p) => s + p.parcelCount, 0),
          payableINR: projects.reduce((s, p) => s + p.payableINR, 0),
          paidINR: projects.reduce((s, p) => s + p.paidINR, 0),
          atRisk: projects.reduce((s, p) => s + p.atRiskCases, 0),
          breached: projects.reduce((s, p) => s + p.breachedCases, 0),
          flagged: projects.reduce((s, p) => s + p.flaggedCaptures, 0)
        },
        integrations: integrationStatus()
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Field verifier: today's assignments and the offline sync endpoint
   * ---------------------------------------------------------------- */

  app.get('/api/field/assignments', requirePermission('assignment.read.own'), async (req, res, next) => {
    try {
      const conn = await db();
      const rows = await conn.all(
        `select c.id as case_id, c.case_no, c.stage, c.stage_entered_at,
                p.id as parcel_id, p.survey_no, p.record_area_hectares, p.land_class, p.geometry, p.centroid,
                v.name as village_name, v.taluka,
                (select owner_name from parcel_owners o where o.parcel_id = p.id order by o.id limit 1) as owner_name,
                (select count(*) from field_captures fc where fc.case_id = c.id) as existing_captures
         from cases c
         join parcels p on p.id = c.parcel_id
         left join villages v on v.id = p.village_id
         where c.track = 'acquisition' and c.stage in ('SURVEY_AND_DEMARCATION','OBJECTIONS_HEARD','NOTIFICATION_ISSUED')
         order by c.priority desc, c.stage_entered_at
         limit 40`
      );
      res.json({
        assignments: rows.map((r) => ({
          caseId: r.case_id,
          caseNo: r.case_no,
          parcelId: r.parcel_id,
          surveyNo: r.survey_no,
          village: r.village_name,
          taluka: r.taluka,
          ownerName: r.owner_name,
          recordAreaHectares: Number(r.record_area_hectares),
          landClass: r.land_class,
          stage: r.stage,
          geometry: jparse(r.geometry),
          centroid: jparse(r.centroid),
          captureCount: r.existing_captures
        })),
        minCorners: 3,
        accuracyMaxM: Number(process.env.NILAM_ACCURACY_MAX_M || 15),
        integrations: integrationStatus()
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Offline sync: replays queued captures one at a time.
   * Each item is adjudicated independently so one bad frame cannot lose the rest,
   * which is the behaviour the brief's "nothing is ever lost" requires.
   */
  app.post('/api/field/sync', requirePermission('sync.run'), async (req, res, next) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : null;
      if (!items) return res.status(400).json({ error: { code: 'MISSING_ITEMS', message: 'items must be an array of queued captures.' } });
      if (items.length > 200) return res.status(413).json({ error: { code: 'BATCH_TOO_LARGE', message: 'Sync batches are limited to 200 items.' } });

      const conn = await db();
      const results = [];
      let accepted = 0;
      let flagged = 0;

      for (const item of items) {
        const clientId = item.clientId ?? null;
        try {
          const caseRow = await conn.get('select * from cases where id = ?', [Number(item.caseId)]);
          if (!caseRow) {
            results.push({ clientId, status: 404, accepted: false, message: 'The case for this capture no longer exists.' });
            continue;
          }
          const parcel = await conn.get('select * from parcels where id = ?', [caseRow.parcel_id]);
          const corners = (item.corners || []).map((c, i) => ({
            index: i + 1,
            lat: Number(c.lat), lon: Number(c.lon),
            accuracy: c.accuracyM !== undefined ? Number(c.accuracyM) : null,
            heading: c.headingDeg !== undefined ? Number(c.headingDeg) : null,
            photoHash: c.photoHash ?? null,
            capturedAt: c.capturedAt ?? nowIso(),
            mockLocation: Boolean(c.mockLocation)
          }));
          if (corners.length < 3) {
            results.push({ clientId, status: 400, accepted: false, message: 'Fewer than 3 corners; the boundary cannot be formed.' });
            continue;
          }

          const { found, surveyedArea, polygon, clientArea } = await detectDiscrepancies(conn, {
            caseRow, parcel, corners, clientArea: item.clientAreaHectares ?? null
          });
          const isFlagged = found.some((d) => d.severity === 'critical');
          const captureRef = `CAP-${Date.now().toString(36).toUpperCase()}-${results.length}`;
          const at = nowIso();

          const id = await conn.transaction(async (tx) => {
            const row = await tx.run(
              `insert into field_captures (capture_ref, case_id, parcel_id, verifier_id, verifier_name, status,
                  surveyed_area_hectares, client_area_hectares, polygon, corner_count, gps_flagged,
                  captured_at, synced_at, synced_offline, note, device)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
              [
                captureRef, caseRow.id, parcel.id, req.user.id, req.user.name,
                isFlagged ? 'flagged' : 'verified',
                Math.round(surveyedArea * 10000) / 10000,
                clientArea === null ? null : Math.round(Number(clientArea) * 10000) / 10000,
                JSON.stringify(polygon), corners.length,
                found.some((d) => d.type === 'SUSPICIOUS_GPS') ? 1 : 0,
                at, at, item.note ?? null, item.device ?? 'NiLaM Field (offline)'
              ]
            );
            const captureId = row.lastInsertRowid;
            for (const c of corners) {
              await tx.run(
                `insert into field_corners (capture_id, corner_index, latitude, longitude, accuracy_m, heading_deg, point, photo_hash, captured_at, is_mock_location)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [captureId, c.index, c.lat, c.lon, c.accuracy, c.heading, JSON.stringify([c.lon, c.lat]), c.photoHash, c.capturedAt, c.mockLocation ? 1 : 0]
              );
            }
            for (const d of found) {
              await tx.run(
                `insert into discrepancies (case_id, capture_id, type, severity, detail, measured_value, expected_value, delta_ratio, detected_at)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [caseRow.id, captureId, d.type, d.severity, d.detail, d.measured ?? null, d.expected ?? null, d.delta ?? null, at]
              );
            }
            await tx.run('update cases set area_surveyed_hectares = ?, updated_at = ? where id = ?', [
              Math.round(surveyedArea * 10000) / 10000, at, caseRow.id
            ]);
            return captureId;
          });

          await appendLedger(conn, {
            actor: req.user,
            action: isFlagged ? 'FIELD_CAPTURE_FLAGGED' : 'FIELD_CAPTURE_VERIFIED',
            subject: `case:${caseRow.id}`,
            detail: { captureId: id, captureRef, via: 'offline-sync', surveyedAreaHectares: Math.round(surveyedArea * 10000) / 10000, discrepancies: found.map((d) => d.type) }
          });

          if (isFlagged) flagged += 1;
          else accepted += 1;
          results.push({
            clientId, status: 201, accepted: true, captureId: id, captureRef,
            flagged: isFlagged,
            surveyedAreaHectares: Math.round(surveyedArea * 10000) / 10000,
            discrepancies: found.map((d) => d.type),
            message: isFlagged ? 'Synced and flagged for review.' : 'Synced and verified.'
          });
        } catch (itemErr) {
          results.push({ clientId, status: 500, accepted: false, message: itemErr.message });
        }
      }

      await conn.run(
        'insert into sync_log (client_id, user_id, item_count, accepted, flagged, failed, at) values (?, ?, ?, ?, ?, ?, ?)',
        [String(req.body?.clientId || 'unknown'), req.user.id, items.length, accepted, flagged, items.length - accepted - flagged, nowIso()]
      );

      res.json({
        received: items.length,
        accepted,
        flagged,
        failed: items.length - accepted - flagged,
        results
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * CALM and PULSE
   * ---------------------------------------------------------------- */

  /**
   * Computes both demonstration models for a case and persists the results.
   *
   * The statutory floor is reconciled here rather than in the UI, so a stored
   * estimate can never disagree with the amount that would lawfully be paid.
   */
  app.post('/api/cases/:id/models/run', requirePermission('compensation.read'), async (req, res, next) => {
    try {
      const conn = await db();
      const caseRow = await conn.get('select * from cases where id = ?', [Number(req.params.id)]);
      if (!caseRow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such case.' } });

      const ctx = await buildCaseContext(conn, caseRow);
      const villageAvg = ctx.village ? Number(ctx.village.guidance_rate_per_hectare) : null;

      const calm = calmEstimate(parcelInputFromRow(ctx.parcel, villageAvg), villageAvg);
      const pulse = pulseScore(pulseInputFromContext(ctx));
      const at = nowIso();

      await conn.transaction(async (tx) => {
        await tx.run(
          `insert into compensation_estimates (case_id, source, model_version, amount_inr, amount_low_inr, amount_high_inr, statutory_floor_inr, below_floor, factors, created_at)
           values (?, 'calm', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            caseRow.id, calm.modelVersion, calm.estimateINR, calm.rangeLowINR, calm.rangeHighINR,
            calm.statutoryFloorINR, calm.belowFloor ? 1 : 0,
            JSON.stringify(calm.factors), at
          ]
        );
        await tx.run(
          `insert into risk_scores (case_id, model_version, probability, tier, reasons, recommended_action, rule_baseline_score, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            caseRow.id, pulse.modelVersion, pulse.probability, pulse.tier,
            JSON.stringify(pulse.reasons), pulse.recommendedAction, pulse.score, at
          ]
        );
      });

      await appendLedger(conn, {
        actor: req.user,
        action: 'MODELS_RUN',
        subject: `case:${caseRow.id}`,
        detail: {
          calm: { estimateINR: calm.estimateINR, statutoryFloorINR: calm.statutoryFloorINR, belowFloor: calm.belowFloor },
          pulse: { probability: pulse.probability, tier: pulse.tier, score: pulse.score },
          note: 'demonstration weighted-factor models'
        }
      });

      res.json({
        caseId: caseRow.id,
        calm,
        pulse,
        governingAmountINR: calm.governingAmountINR,
        governingBasis: calm.governingBasis
      });
    } catch (err) {
      next(err);
    }
  });

  /** The model card: what these are, and what they are not. */
  app.get('/api/models', async (_req, res, next) => {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const here = path.dirname(fileURLToPath(import.meta.url));
      const reportPath = path.resolve(here, '../ml/artefacts/metrics.json');
      const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
      res.json({
        modelVersion: MODEL_VERSION,
        report,
        note: report
          ? 'Demonstration weighted-factor models. Not trained models; no accuracy is claimed.'
          : 'Model card not built yet. Run: python services/ml/build_models.py'
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------------------------------------------- *
   * Audit and compliance
   * ---------------------------------------------------------------- */

  app.get('/api/audit/verify', requirePermission('audit.read'), async (_req, res, next) => {
    try {
      const conn = await db();
      const rows = await conn.all('select seq, at, actor_name, action, subject, detail, prev_hash, hash from audit_ledger order by seq');
      const { verifyChain: vc } = await import('../../packages/crypto/index.mjs');
      const broken = vc(rows);
      res.status(broken === -1 ? 200 : 409).json({
        intact: broken === -1,
        entries: rows.length,
        firstBrokenIndex: broken === -1 ? null : broken,
        head: rows.length ? rows[rows.length - 1].hash : null,
        algorithm: 'SHA-256 hash chain; each entry commits to its predecessor',
        verdict: broken === -1
          ? 'Intact: every entry matches its recorded hash and links to its predecessor.'
          : `TAMPERED: entry ${broken} does not match its recorded hash or breaks the chain.`
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/audit', requirePermission('audit.read'), async (req, res, next) => {
    try {
      const conn = await db();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const rows = await conn.all('select * from audit_ledger order by seq desc limit ?', [limit]);
      res.json({
        entries: rows.map((e) => ({
          seq: e.seq, at: e.at, actor: e.actor_name, role: e.actor_role,
          action: e.action, subject: e.subject, detail: jparse(e.detail), hash: e.hash, prevHash: e.prev_hash
        }))
      });
    } catch (err) {
      next(err);
    }
  });
}
