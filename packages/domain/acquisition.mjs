/**
 * NiLaM domain: acquisition workflow.
 *
 * Ported from the previous CLANS prototype, which modelled this correctly and is
 * the single most valuable thing to carry forward. The statutory stage machine,
 * the SLA clock and the compensation arithmetic are preserved essentially
 * unchanged; what is new is the per-parcel clearance concept the brief requires
 * and a citizen-facing projection of the same stages.
 *
 * Authority: Right to Fair Compensation and Transparency in Land Acquisition,
 * Rehabilitation and Resettlement Act, 2013 (RFCTLARR), with the National
 * Highways Act 1956 s.3A-3H track noted where the two diverge.
 */

/* ------------------------------------------------------------------ *
 * Statutory stages
 * ------------------------------------------------------------------ */

export const STAGES = [
  {
    id: 'NOTIFICATION_ISSUED',
    label: 'Preliminary Notification',
    short: 'Notification',
    order: 1,
    legalRef: 'RFCTLARR s.11 / NH Act s.3A',
    slaDays: 30,
    actorRole: 'lao',
    citizenExplanation:
      'The government has published its intention to acquire your land. You will receive a copy at your registered address and it is published in two newspapers.',
    description:
      'Preliminary notification published in the Official Gazette and two local newspapers, declaring intent to acquire the specified land for a public purpose.',
    requiredDocs: [],
    producesDocs: ['PRELIMINARY_NOTIFICATION', 'NEWSPAPER_PUBLICATION'],
    next: ['OBJECTIONS_HEARD']
  },
  {
    id: 'OBJECTIONS_HEARD',
    label: 'Objections Heard (s.15 enquiry)',
    short: 'Objections',
    order: 2,
    legalRef: 'RFCTLARR s.15',
    slaDays: 60,
    actorRole: 'lao',
    citizenExplanation:
      'You may object to the acquisition or to the area measured. The Collector will hear you in person and record what you say.',
    description:
      'Collector hears objections from interested persons on the demarcation and the area proposed, and records findings.',
    requiredDocs: ['PRELIMINARY_NOTIFICATION'],
    producesDocs: ['OBJECTION_HEARING_MINUTES'],
    next: ['SURVEY_AND_DEMARCATION', 'OBJECTION_UPHELD']
  },
  {
    id: 'SURVEY_AND_DEMARCATION',
    label: 'Survey & Demarcation',
    short: 'Survey',
    order: 3,
    legalRef: 'RFCTLARR s.16 / DILRMP ground-truthing',
    slaDays: 45,
    actorRole: 'field_verifier',
    citizenExplanation:
      'A field officer will visit your land and measure it corner by corner, with photographs. You or your representative should be present.',
    description:
      'Field survey of the proposed extent, measurement of the exact area, geo-tagged photographic evidence and joint demarcation with the landholder.',
    requiredDocs: ['PRELIMINARY_NOTIFICATION'],
    producesDocs: ['SURVEY_REPORT', 'FIELD_VERIFICATION'],
    next: ['AWARD_DRAFTED']
  },
  {
    id: 'AWARD_DRAFTED',
    label: 'Draft Award & Valuation',
    short: 'Draft Award',
    order: 4,
    legalRef: 'RFCTLARR s.23, First Schedule',
    slaDays: 30,
    actorRole: 'lao',
    citizenExplanation:
      'The amount to be paid for your land has been worked out from the government guidance rate and recent sales nearby, plus the additional statutory amounts. You will be shown the figure and how it was reached.',
    description:
      'Market value computed from the circle/guidance rate and recent registered sales, with solatium and R&R entitlements added.',
    requiredDocs: ['SURVEY_REPORT', 'VALUATION_REPORT'],
    producesDocs: ['DRAFT_AWARD', 'VALUATION_REPORT'],
    next: ['AWARD_APPROVED']
  },
  {
    id: 'AWARD_APPROVED',
    label: 'Award Approved',
    short: 'Award Approved',
    order: 5,
    legalRef: 'RFCTLARR s.30 (Collector to approve)',
    slaDays: 30,
    actorRole: 'collector',
    citizenExplanation:
      'The Collector has approved the final amount. This is the government\'s commitment to pay you.',
    description:
      'Collector approves the award after verifying title, valuation and R&R entitlements. This is the cost-commitment gate.',
    requiredDocs: ['DRAFT_AWARD', 'TITLE_VERIFICATION'],
    producesDocs: ['AWARD'],
    next: ['COMPENSATION_PAID']
  },
  {
    id: 'COMPENSATION_PAID',
    label: 'Compensation Disbursed',
    short: 'Paid',
    order: 6,
    legalRef: 'RFCTLARR s.31 / PFMS transfer',
    slaDays: 30,
    actorRole: 'treasury',
    citizenExplanation:
      'The money is transferred directly to the bank account you registered. You will receive an SMS with the reference number.',
    description:
      'Compensation credited through the Public Financial Management System to the bank account of the recorded landholder.',
    requiredDocs: ['AWARD', 'BANK_MANDATE'],
    producesDocs: ['PAYMENT_ADVICE', 'BANK_MANDATE'],
    next: ['POSSESSION_TAKEN']
  },
  {
    id: 'POSSESSION_TAKEN',
    label: 'Possession & Handover',
    short: 'Possession',
    order: 7,
    legalRef: 'RFCTLARR s.38 / NH Act s.3E',
    slaDays: 30,
    actorRole: 'lao',
    citizenExplanation:
      'The land is formally taken over and the revenue records are updated in the government\'s name. Your name is removed from the 7/12 for the acquired extent.',
    description:
      'Land taken possession of, Section-24(2)/3E vesting recorded, entry made in the Record of Rights (7/12 or khata) and the corridor handed to the executing agency.',
    requiredDocs: ['PAYMENT_ADVICE'],
    producesDocs: ['POSSESSION_CERTIFICATE', 'ROR_MUTATION_ENTRY'],
    next: []
  }
];

/** Terminal off-ramp: an objection sustained or litigation halts the linear flow. */
export const BLOCKED_STAGE = {
  id: 'OBJECTION_UPHELD',
  label: 'Objection Upheld / Under Litigation',
  short: 'Disputed',
  order: 0,
  legalRef: 'RFCTLARR s.15(3), s.64 reference',
  slaDays: 90,
  actorRole: 'collector',
  citizenExplanation:
    'Your objection was accepted, or the matter has gone to the Land Acquisition Authority. The acquisition is paused until this is decided.',
  description:
    'Objection sustained or reference made to the Land Acquisition, Rehabilitation and Resettlement Authority; the acquisition is held in abeyance pending resolution.',
  requiredDocs: ['OBJECTION_HEARING_MINUTES'],
  producesDocs: ['LITIGATION_REFERENCE'],
  next: ['SURVEY_AND_DEMARCATION']
};

export const STAGE_BY_ID = new Map([...STAGES, BLOCKED_STAGE].map((s) => [s.id, s]));

/** The linear sequence used for progress and the citizen-facing tracker. */
export const PIPELINE = STAGES.map((s) => s.id);

/* ------------------------------------------------------------------ *
 * Document types
 * ------------------------------------------------------------------ */

export const DOC_TYPES = [
  { id: 'PRELIMINARY_NOTIFICATION', label: 'Preliminary Notification (s.11)', category: 'notice' },
  { id: 'NEWSPAPER_PUBLICATION', label: 'Newspaper Publication Proof', category: 'notice' },
  { id: 'OBJECTION_HEARING_MINUTES', label: 'Objection Hearing Minutes', category: 'proceedings' },
  { id: 'OBJECTION_FILED', label: 'Objection Filed by Owner', category: 'proceedings' },
  { id: 'SURVEY_REPORT', label: 'Survey & Demarcation Report', category: 'survey' },
  { id: 'FIELD_VERIFICATION', label: 'Geo-tagged Field Verification Record', category: 'survey' },
  { id: 'VALUATION_REPORT', label: 'Valuation Report', category: 'valuation' },
  { id: 'DRAFT_AWARD', label: 'Draft Award Statement', category: 'award' },
  { id: 'TITLE_VERIFICATION', label: 'Title Verification / ROR Extract', category: 'title' },
  { id: 'AWARD', label: 'Award (s.30)', category: 'award' },
  { id: 'BANK_MANDATE', label: 'Bank Mandate / Account Details', category: 'payment' },
  { id: 'PAYMENT_ADVICE', label: 'Payment Advice', category: 'payment' },
  { id: 'CONSENT_FORM', label: 'Consent Form', category: 'consent' },
  { id: 'POSSESSION_CERTIFICATE', label: 'Possession Certificate', category: 'possession' },
  { id: 'ROR_MUTATION_ENTRY', label: 'Record of Rights Mutation Entry', category: 'possession' },
  { id: 'LITIGATION_REFERENCE', label: 'Reference to LARR Authority', category: 'litigation' },
  // Purchase track (sub-registrar workflow)
  { id: 'SALE_DEED_DRAFT', label: 'Draft Sale Deed', category: 'purchase' },
  { id: 'ENCUMBRANCE_CERTIFICATE', label: 'Encumbrance Certificate', category: 'purchase' },
  { id: 'SELLER_TITLE_DEED', label: 'Seller Title Deed', category: 'purchase' },
  { id: 'CONSIDERATION_PROOF', label: 'Proof of Consideration', category: 'purchase' },
  { id: 'NO_DUES_CERTIFICATE', label: 'No Dues / Property Tax Certificate', category: 'purchase' },
  { id: 'REGISTRATION_RECEIPT', label: 'Registration Receipt', category: 'purchase' }
];

export const DOC_TYPE_BY_ID = new Map(DOC_TYPES.map((d) => [d.id, d]));

/* ------------------------------------------------------------------ *
 * Roles
 *
 * Four product roles per the brief. "Officer" is one role with a designation
 * discriminator, because the brief describes four officer types that share a
 * workflow shape while requiring role-specific MIS.
 * ------------------------------------------------------------------ */

export const OFFICER_DESIGNATIONS = [
  {
    id: 'sub_registrar',
    label: 'Sub-Registrar (Registration)',
    track: 'purchase',
    queueLabel: 'Purchase cases awaiting scrutiny'
  },
  {
    id: 'lao',
    label: 'Land Acquisition Officer',
    track: 'acquisition',
    queueLabel: 'Acquisition cases in your stage'
  },
  {
    id: 'collector',
    label: 'Collector / Competent Authority',
    track: 'acquisition',
    queueLabel: 'Approvals pending and at-risk cases'
  },
  {
    id: 'treasury',
    label: 'Treasury / Accounts Officer',
    track: 'acquisition',
    queueLabel: 'Payments due and failed payments'
  }
];

export const ROLES = {
  citizen: {
    id: 'citizen',
    label: 'Citizen / Landholder',
    platform: 'mobile',
    permissions: [
      'request.create', 'request.read.own', 'case.read.own', 'case.track',
      'notice.read.own', 'consent.submit.own', 'objection.file.own',
      'document.read.own', 'document.upload.own', 'compensation.view.own',
      'identity.link.own', 'notification.read.own'
    ]
  },
  government: {
    id: 'government',
    label: 'Government / Requesting Agency',
    platform: 'web',
    permissions: [
      'project.create', 'project.read', 'project.manage', 'parcel.read',
      'case.read', 'approval.grant', 'budget.read', 'dashboard.read',
      'document.read', 'report.read', 'notification.read.own'
    ]
  },
  officer: {
    id: 'officer',
    label: 'Officer',
    platform: 'web',
    // Effective permissions are this set intersected with the designation's own
    // track, which is how a Sub-Registrar is kept out of acquisition cases.
    permissions: [
      'case.read', 'case.read.queue', 'case.transition', 'case.approve',
      'case.return', 'case.escalate', 'field.assign', 'document.read',
      'document.upload', 'document.issue', 'clearance.run', 'clearance.read',
      'discrepancy.read', 'compensation.read', 'compensation.decide',
      'payment.release', 'search.global', 'dashboard.read', 'report.read',
      'notification.read.own', 'audit.read'
    ]
  },
  field_verifier: {
    id: 'field_verifier',
    label: 'Field Verifier',
    platform: 'mobile',
    permissions: [
      'assignment.read.own', 'parcel.read.assigned', 'capture.submit',
      'capture.read.own', 'document.read', 'sync.run', 'notification.read.own'
    ]
  },
  auditor: {
    id: 'auditor',
    label: 'Audit & Vigilance (read-only)',
    platform: 'web',
    permissions: [
      'case.read', 'document.read', 'audit.read', 'discrepancy.read',
      'compensation.read', 'dashboard.read', 'report.read'
    ]
  }
};

/** True when a role holds a permission. */
export function can(roleId, permission) {
  const role = ROLES[roleId];
  return Boolean(role && role.permissions.includes(permission));
}

/**
 * True when an officer designation may act on a given track.
 * A Sub-Registrar handles purchase; acquisition officers handle acquisition.
 */
export function designationCoversTrack(designation, track) {
  const found = OFFICER_DESIGNATIONS.find((d) => d.id === designation);
  if (!found) return false;
  if (found.id === 'collector') return true; // the Collector sits above both tracks
  return found.track === track;
}

export const PURCHASE_STAGES = [
  {
    id: 'REQUEST_SUBMITTED',
    label: 'Request Submitted',
    short: 'Requested',
    order: 1,
    slaDays: 7,
    actorRole: 'sub_registrar',
    citizenExplanation: 'Your request has been received and given a case number.',
    requiredDocs: [],
    producesDocs: [],
    next: ['OWNER_VERIFIED']
  },
  {
    id: 'OWNER_VERIFIED',
    label: 'Owner Verified',
    short: 'Owner verified',
    order: 2,
    slaDays: 10,
    actorRole: 'sub_registrar',
    citizenExplanation:
      'The seller\'s identity was verified through DigiLocker and matched against the land record. No Aadhaar number is stored by NiLaM.',
    requiredDocs: [],
    producesDocs: [],
    next: ['DOCUMENTS_CHECKED']
  },
  {
    id: 'DOCUMENTS_CHECKED',
    label: 'Documents Checked',
    short: 'Documents checked',
    order: 3,
    slaDays: 15,
    actorRole: 'sub_registrar',
    citizenExplanation:
      'The title deed, encumbrance certificate and property tax records were examined for disputes, loans or claims against the land.',
    requiredDocs: ['SELLER_TITLE_DEED', 'ENCUMBRANCE_CERTIFICATE'],
    producesDocs: ['TITLE_VERIFICATION'],
    next: ['FIELD_SURVEY']
  },
  {
    id: 'FIELD_SURVEY',
    label: 'Field Survey',
    short: 'Field survey',
    order: 4,
    slaDays: 20,
    actorRole: 'field_verifier',
    citizenExplanation:
      'A field officer measured the land corner by corner. If the measured area differs from the record, the case is flagged for review.',
    requiredDocs: [],
    producesDocs: ['SURVEY_REPORT'],
    next: ['DECISION']
  },
  {
    id: 'DECISION',
    label: 'Registration Decision',
    short: 'Decision',
    order: 5,
    slaDays: 10,
    actorRole: 'sub_registrar',
    citizenExplanation:
      'A decision has been recorded. If accepted, the sale deed can be registered. If returned, the list of corrections is on your case page.',
    requiredDocs: [],
    producesDocs: ['REGISTRATION_RECEIPT'],
    next: []
  }
];

export const PURCHASE_STAGE_BY_ID = new Map(PURCHASE_STAGES.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ *
 * Transition validation (server-side authority)
 * ------------------------------------------------------------------ */

/**
 * Validates a proposed transition.
 *
 * Returns `{ ok: true, stage }` or `{ ok: false, code, message, details }`.
 * The four checks, in order: unknown stage, illegal edge, role authority, and
 * statutory document prerequisites. The award gate additionally requires an
 * accepted field verification, so the award can never be drafted on paperwork
 * alone.
 */
export function validateTransition({
  from,
  to,
  role,
  designation = null,
  track = 'acquisition',
  docs = [],
  verifications = [],
  caseRow = null
}) {
  const table = track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;

  if (!table.has(to)) {
    return { ok: false, code: 'UNKNOWN_STAGE', message: `Unrecognised stage "${to}"` };
  }
  const target = table.get(to);
  const current = from ? table.get(from) : null;

  if (from && !current) {
    return { ok: false, code: 'UNKNOWN_STAGE', message: `Unrecognised current stage "${from}"` };
  }

  if (current) {
    if (!current.next.includes(to)) {
      const permitted = current.next.map((n) => table.get(n).short).join(', ') || 'none (terminal stage)';
      return {
        ok: false,
        code: 'ILLEGAL_EDGE',
        message: `"${current.short}" cannot advance directly to "${target.short}". Permitted: ${permitted}`
      };
    }
    if (current.order > 0 && target.order > 0 && target.order < current.order) {
      return {
        ok: false,
        code: 'BACKWARD_TRANSITION',
        message: 'The workflow cannot move backwards without a formal review order.'
      };
    }
  }

  // Role authority: the stage's owning role, or a role that outranks it.
  const authority = target.actorRole;
  const overrides = new Set([authority, 'lao', 'collector']);
  if (role === 'officer' && designation) {
    if (designation === 'sub_registrar' && track !== 'purchase') {
      return {
        ok: false,
        code: 'WRONG_TRACK',
        message: 'A Sub-Registrar processes private-sale registrations, not acquisition cases.'
      };
    }
    if (designation !== 'sub_registrar' && designation !== 'collector' && track === 'purchase') {
      return {
        ok: false,
        code: 'WRONG_TRACK',
        message: 'This acquisition officer does not process private-sale registrations.'
      };
    }
  }
  if (role !== 'officer' && role !== 'collector' && role !== authority) {
    return {
      ok: false,
      code: 'FORBIDDEN_ROLE',
      message: `Only the ${ROLES[authority]?.label || authority} may action "${target.label}".`
    };
  }
  if (role === 'officer' && !overrides.has(designation) && designation !== 'lao') {
    return {
      ok: false,
      code: 'FORBIDDEN_ROLE',
      message: `The ${designation} designation may not action "${target.label}".`
    };
  }

  const available = new Set(docs.map((d) => d.type));
  const missing = (target.requiredDocs || []).filter((d) => !available.has(d));
  if (missing.length) {
    return {
      ok: false,
      code: 'MISSING_DOCUMENTS',
      message: `Cannot enter "${target.label}" — missing: ${missing
        .map((m) => DOC_TYPE_BY_ID.get(m)?.label || m)
        .join(', ')}`,
      details: { missing }
    };
  }

  // Ground-truth gate: the award cannot be drafted without an accepted,
  // corner-based field verification.
  if (to === 'AWARD_DRAFTED' && caseRow) {
    const accepted = verifications.filter((v) => v.status === 'verified');
    if (!accepted.length) {
      return {
        ok: false,
        code: 'MISSING_FIELD_VERIFICATION',
        message:
          'Cannot draft the award — no accepted corner-based field verification exists for this parcel.'
      };
    }
  }

  return { ok: true, stage: target };
}

/* ------------------------------------------------------------------ *
 * Clearance checks (per parcel / per owner case)
 *
 * The brief requires these to be evaluated per parcel and surfaced as a plain
 * checklist, never collapsed into one project-level result.
 * ------------------------------------------------------------------ */

export const CLEARANCE_ITEMS = [
  {
    id: 'litigation',
    label: 'Litigation history',
    question: 'Is any court case pending over this land?',
    clearWhen: (c) => !c.litigation || c.litigation.length === 0,
    severity: 'critical',
    action: 'Do not proceed to award. Obtain the Collector\'s order on the pending case.'
  },
  {
    id: 'title_dispute',
    label: 'Title dispute',
    question: 'Is ownership disputed by any person?',
    clearWhen: (c) => !c.titleDispute,
    severity: 'critical',
    action: 'Refer under s.64 to the LARR Authority and hold the acquisition in abeyance.'
  },
  {
    id: 'co_owners',
    label: 'Co-owners and legal heirs',
    question: 'Have all recorded co-owners and legal heirs consented?',
    clearWhen: (c) => (c.coOwnerCount || 1) <= 1 || Boolean(c.allCoOwnersConsented),
    severity: 'warning',
    action: 'Obtain consent from every co-owner, or serve each of them individually.'
  },
  {
    id: 'encumbrance',
    label: 'Encumbrances',
    question: 'Is the land mortgaged or otherwise charged?',
    clearWhen: (c) => !c.encumbrance,
    severity: 'warning',
    action: 'Apportion the award to discharge the charge under s.31(2).'
  },
  {
    id: 'prior_acquisition',
    label: 'Earlier acquisition attempts',
    question: 'Was this land subject to an earlier acquisition or notification?',
    clearWhen: (c) => !c.priorAcquisition,
    severity: 'warning',
    action: 'Reconcile with the earlier proceedings before issuing a fresh notification.'
  },
  {
    id: 'documents_complete',
    label: 'Record of Rights and title documents',
    question: 'Are the 7/12 extract and title documents on file?',
    clearWhen: (c) => Boolean(c.rorOnFile),
    severity: 'critical',
    action: 'Obtain the Record of Rights extract before computing the award.'
  }
];

/** Evaluates every clearance item for one parcel/owner case. */
export function runClearanceChecks(clearance = {}) {
  const items = CLEARANCE_ITEMS.map((item) => {
    let clear = false;
    try {
      clear = Boolean(item.clearWhen(clearance));
    } catch {
      clear = false;
    }
    return {
      id: item.id,
      label: item.label,
      question: item.question,
      clear,
      severity: item.severity,
      action: clear ? null : item.action
    };
  });
  const blockers = items.filter((i) => !i.clear && i.severity === 'critical');
  const warnings = items.filter((i) => !i.clear && i.severity === 'warning');
  return {
    items,
    clearCount: items.filter((i) => i.clear).length,
    total: items.length,
    blockers: blockers.length,
    warnings: warnings.length,
    /**
     * A case is only clear to progress when no critical item is outstanding.
     * Warnings are surfaced and must be acknowledged, but do not by themselves
     * stop a lawful acquisition.
     */
    cleared: blockers.length === 0,
    headline: blockers.length
      ? `${blockers.length} issue${blockers.length === 1 ? '' : 's'} must be resolved first: ${blockers
          .map((b) => b.label)
          .join(', ')}`
      : warnings.length
        ? `Clear to proceed, with ${warnings.length} matter${warnings.length === 1 ? '' : 's'} to note.`
        : 'All clearance checks passed.'
  };
}

/* ------------------------------------------------------------------ *
 * SLA clock
 * ------------------------------------------------------------------ */

/** Statutory SLA for a stage, adjusted for the legitimate drivers of delay. */
export function slaDaysFor(stageId, kase = {}, track = 'acquisition') {
  const table = track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;
  const stage = table.get(stageId);
  if (!stage) return 30;
  let days = stage.slaDays;
  if (kase.landClass === 'homestead') days += 15;
  if (kase.landClass === 'commercial') days += 10;
  if (kase.hasActiveDispute) days += 60;
  if (kase.coOwnerCount > 3) days += 20;
  if (kase.areaHectares > 1) days += 10;
  return days;
}

/** Age of the current stage and its verdict against the statutory clock. */
export function slaState(kase, now = Date.now(), track = 'acquisition') {
  const table = track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;
  const stage = table.get(kase.stage);
  const enteredAt = kase.stageEnteredAt ? Date.parse(kase.stageEnteredAt) : now;
  const elapsedDays = Math.max(0, (now - enteredAt) / 86400000);
  const allowed = slaDaysFor(kase.stage, kase, track);
  const ratio = allowed > 0 ? elapsedDays / allowed : 0;

  const terminal = track === 'purchase' ? 'DECISION' : 'POSSESSION_TAKEN';
  let verdict = 'on_track';
  if (kase.stage === terminal || kase.stage === 'OBJECTION_UPHELD') {
    verdict = kase.stage === terminal ? 'closed' : 'blocked';
  } else if (ratio > 1) verdict = 'breached';
  else if (ratio > 0.75) verdict = 'at_risk';

  return {
    stageId: kase.stage,
    stageLabel: stage?.short || kase.stage,
    enteredAt: kase.stageEnteredAt,
    elapsedDays: Math.round(elapsedDays * 10) / 10,
    slaDays: allowed,
    daysRemaining: Math.round((allowed - elapsedDays) * 10) / 10,
    utilisation: Math.round(ratio * 1000) / 1000,
    verdict
  };
}

/** Progress through the linear pipeline, 0..1. */
export function progressOf(kase, track = 'acquisition') {
  const table = track === 'purchase' ? PURCHASE_STAGE_BY_ID : STAGE_BY_ID;
  const total = (track === 'purchase' ? PURCHASE_STAGES : STAGES).length;
  if (kase.stage === 'OBJECTION_UPHELD') return 0;
  const stage = table.get(kase.stage);
  if (!stage) return 0;
  const completed = stage.next.length === 0 ? total : stage.order - 1;
  return Math.round((completed / total) * 1000) / 1000;
}

/* ------------------------------------------------------------------ *
 * Compensation — the statutory floor
 * ------------------------------------------------------------------ */

export const LAND_CLASS_FACTORS = {
  agricultural: 1.0,
  barren: 0.7,
  homestead: 1.6,
  commercial: 2.4,
  forest: 0.9,
  waterbody: 0.8
};

/**
 * Statutory minimum compensation.
 *
 *   marketValue = area (ha) x guidance rate (INR/ha) x land-class factor
 *   solatium    = marketValue x 100%       [RFCTLARR First Schedule, s.30(1)]
 *   R&R         = fixed entitlement        [RFCTLARR Second Schedule]
 *
 * CALM must always be reconciled against this: the model may predict higher, but
 * it may never be allowed to pay less than the law requires.
 */
export function statutoryFloor(parcel) {
  const factor = LAND_CLASS_FACTORS[parcel.landClass] ?? 1.0;
  const areaHectares = Number(parcel.areaHectares) || 0;
  const guidanceRate = Number(parcel.guidanceRatePerHectare) || 0;

  const marketValue = Math.round(areaHectares * guidanceRate * factor);
  const solatium = Math.round(marketValue * 1.0);
  const rrEntitlement = Number(parcel.rrEntitlement) || 0;
  const total = marketValue + solatium + rrEntitlement;

  return {
    areaHectares,
    guidanceRatePerHectare: guidanceRate,
    landClass: parcel.landClass || 'agricultural',
    landClassFactor: factor,
    marketValue,
    solatium,
    solatiumRate: 1.0,
    rrEntitlement,
    total,
    basis: 'RFCTLARR 2013 First Schedule (market value + 100% solatium) and Second Schedule (R&R)'
  };
}

/* ------------------------------------------------------------------ *
 * Rule engine — the transparent baseline PULSE is compared against
 * ------------------------------------------------------------------ */

export const RULES = [
  {
    id: 'SLA_BREACH',
    severity: 'critical',
    title: 'Statutory clock breached',
    test: (k, ctx) => ctx.sla.verdict === 'breached',
    detail: (k, ctx) =>
      `In "${ctx.sla.stageLabel}" for ${ctx.sla.elapsedDays} days against an SLA of ${ctx.sla.slaDays} days.`,
    action: 'Escalate to the Collector and record the reason for delay on the case file.'
  },
  {
    id: 'SLA_AT_RISK',
    severity: 'warning',
    title: 'SLA nearing breach',
    test: (k, ctx) => ctx.sla.verdict === 'at_risk',
    detail: (k, ctx) =>
      `${ctx.sla.daysRemaining} days remain in "${ctx.sla.stageLabel}" before the statutory clock lapses.`,
    action: 'Place this case in the weekly review.'
  },
  {
    id: 'MISSING_DOCUMENTS',
    severity: 'critical',
    title: 'Required documents not on file',
    test: (k, ctx) => ctx.missingDocs.length > 0,
    detail: (k, ctx) =>
      `The case file lacks: ${ctx.missingDocs.map((d) => DOC_TYPE_BY_ID.get(d)?.label || d).join(', ')}.`,
    action: 'Issue a reminder to the dealing hand or the landholder.'
  },
  {
    id: 'NO_FIELD_VERIFICATION',
    severity: 'warning',
    title: 'No accepted field verification',
    test: (k, ctx) => ctx.sla.stageId === 'SURVEY_AND_DEMARCATION' && !ctx.hasAcceptedVerification,
    detail: () => 'The survey stage is open but no corner-based verification has been accepted.',
    action: 'Assign a field verifier and confirm the corner capture is complete.'
  },
  {
    id: 'AREA_DISCREPANCY',
    severity: 'critical',
    title: 'Surveyed area differs from the record',
    test: (k, ctx) => ctx.discrepancies.some((d) => d.type === 'AREA_MISMATCH'),
    detail: (k, ctx) => {
      const d = ctx.discrepancies.find((x) => x.type === 'AREA_MISMATCH');
      return d ? d.detail : 'The surveyed area differs from the area on record beyond tolerance.';
    },
    action: 'Re-verify the boundary with the landholder present before proceeding.'
  },
  {
    id: 'CLEARANCE_BLOCKER',
    severity: 'critical',
    title: 'Clearance issue unresolved',
    test: (k, ctx) => ctx.clearance && ctx.clearance.blockers > 0,
    detail: (k, ctx) => (ctx.clearance ? ctx.clearance.headline : 'A clearance check is outstanding.'),
    action: 'Resolve the listed clearance items on this case before the next stage.'
  },
  {
    id: 'PAYMENT_FAILED',
    severity: 'critical',
    title: 'Payment failed or returned',
    test: (k, ctx) => ctx.payment && ctx.payment.status === 'failed',
    detail: (k, ctx) => `The bank returned the transfer: ${ctx.payment.failureReason || 'reason not recorded'}.`,
    action: 'Verify the bank mandate with the landholder and re-initiate the transfer.'
  },
  {
    id: 'PAYMENT_PENDING',
    severity: 'critical',
    title: 'Award approved, compensation unpaid',
    test: (k, ctx) => ctx.sla.stageId === 'COMPENSATION_PAID' && ctx.outstanding > 0,
    detail: (k, ctx) =>
      `${formatINR(ctx.outstanding)} remains undisbursed; interest under s.31(3) may accrue.`,
    action: 'Reconcile the bank mandate with PFMS and release the balance.'
  },
  {
    id: 'LOCATION_MISMATCH',
    severity: 'critical',
    title: 'Captured corner outside the notified boundary',
    test: (k, ctx) => ctx.discrepancies.some((d) => d.type === 'CORNER_OUTSIDE_BOUNDARY'),
    detail: () => 'One or more captured corners fall outside the notified boundary.',
    action: 'Re-survey the plot; this usually means a wrong survey number or a wrong parcel.'
  },
  {
    id: 'SUSPICIOUS_GPS',
    severity: 'warning',
    title: 'Suspicious capture location',
    test: (k, ctx) => ctx.discrepancies.some((d) => d.type === 'SUSPICIOUS_GPS'),
    detail: (k, ctx) => {
      const d = ctx.discrepancies.find((x) => x.type === 'SUSPICIOUS_GPS');
      return d ? d.detail : 'The captured coordinates look unreliable.';
    },
    action: 'Re-capture with a clear sky view and confirm the accuracy reading.'
  },
  {
    id: 'STALE_RECORD',
    severity: 'info',
    title: 'No recent activity',
    test: (k, ctx) => ctx.sla.verdict !== 'closed' && ctx.daysSinceActivity > 45,
    detail: (k, ctx) => `No case activity recorded for ${ctx.daysSinceActivity} days.`,
    action: 'Confirm the file has not been misplaced.'
  }
];

export function detectFindings(kase, ctx) {
  return RULES.filter((rule) => {
    try {
      return rule.test(kase, ctx);
    } catch {
      return false;
    }
  }).map((rule) => ({
    ruleId: rule.id,
    severity: rule.severity,
    title: rule.title,
    detail: rule.detail(kase, ctx),
    action: rule.action
  }));
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** Indian short form: ₹1.23 Cr / ₹2.50 L. */
export function formatINR(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(abs >= 1e8 ? 1 : 2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(abs >= 1e6 ? 1 : 2)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  return `₹${Math.round(n)}`;
}

/** Full Indian digit grouping: ₹1,23,45,678. */
export function formatINRFull(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? '-' : '';
  const s = String(Math.abs(n));
  if (s.length <= 3) return `${sign}₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${rest},${last3}`;
}
