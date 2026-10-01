/**
 * External-integration adapters.
 *
 * The brief requires an interface plus a **mock** and a **live-shaped stub** for
 * every external dependency, selected by `NILAM_MODE=demo|live`. Two rules are
 * enforced here rather than left to convention:
 *
 *   1. Every adapter reports `mode` and `isDemonstration`, so the UI can label a
 *      demonstration integration without hard-coding which one it is talking to.
 *   2. The live stubs are *shaped* like the real services but make no network
 *      call. They throw `NotConfiguredError` unless the relevant endpoint is set,
 *      so a demo can never silently present itself as a live government
 *      connection.
 *
 * Nothing here claims to be connected to DigiLocker, Bhu-Naksha, Bhuvan, PFMS or
 * any SMS gateway. The user journeys mirror the real ones; the connections do
 * not exist.
 */

export class NotConfiguredError extends Error {
  constructor(what, envVar) {
    super(`${what} is not configured. Set ${envVar} and NILAM_MODE=live to enable it.`);
    this.name = 'NotConfiguredError';
    this.code = 'NOT_CONFIGURED';
    this.status = 501;
  }
}

export const MODE = process.env.NILAM_MODE === 'live' ? 'live' : 'demo';

/* ------------------------------------------------------------------ *
 * IdentityProvider — DigiLocker-style consent + OTP flow
 * ------------------------------------------------------------------ */

/**
 * The journey this mirrors, and which the UI walks through:
 *   1. request consent  → a consent artefact the user approves
 *   2. issue a one-time code to the registered mobile number
 *   3. verify the code  → an access token
 *   4. fetch the verified profile → name, DOB, address, masked ID reference
 *
 * No raw Aadhaar number is requested, accepted, returned or stored at any point.
 * What is stored is a provider name, an opaque token and the verified display
 * name — which is what the DPDP-aligned design in the brief calls for.
 */
export function identityProvider() {
  if (MODE === 'live') {
    const base = process.env.NILAM_DIGILOCKER_URL;
    return {
      mode: 'live',
      isDemonstration: false,
      name: 'DigiLocker (API Setu)',
      async requestConsent() {
        if (!base) throw new NotConfiguredError('DigiLocker', 'NILAM_DIGILOCKER_URL');
        // A real implementation would POST to `${base}/consent` here.
        throw new NotConfiguredError('DigiLocker consent', 'NILAM_DIGILOCKER_URL');
      },
      async sendOtp() {
        throw new NotConfiguredError('DigiLocker OTP', 'NILAM_DIGILOCKER_URL');
      },
      async verifyOtp() {
        throw new NotConfiguredError('DigiLocker verification', 'NILAM_DIGILOCKER_URL');
      }
    };
  }

  // Deterministic demo OTP so a walkthrough is repeatable.
  const DEMO_OTP = process.env.NILAM_DEMO_OTP || '123456';
  const consents = new Map();
  const challenges = new Map();

  return {
    mode: 'demo',
    isDemonstration: true,
    name: 'DigiLocker (demonstration)',
    disclosure:
      'Demonstration integration. No government service is contacted and no Aadhaar number is collected or stored.',

    async requestConsent({ purpose, requestedBy, subjectName }) {
      const consentId = `CNS-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      consents.set(consentId, { purpose, requestedBy, subjectName, at: new Date().toISOString() });
      return {
        consentId,
        purpose,
        requestedBy,
        // The user-facing text a real consent screen would show.
        statement:
          `You are allowing ${requestedBy} to verify your identity for: ${purpose}. ` +
          `Your Aadhaar number is never shared with or stored by NiLaM.`,
        demonstration: true
      };
    },

    async sendOtp({ consentId, mobile }) {
      if (!consents.has(consentId)) {
        const err = new Error('Consent was not granted, so no code can be sent.');
        err.status = 400;
        err.code = 'CONSENT_REQUIRED';
        throw err;
      }
      const challengeId = `OTP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const masked = mobile ? `${String(mobile).slice(0, 3)}****${String(mobile).slice(-3)}` : 'registered mobile';
      challenges.set(challengeId, { consentId, at: Date.now() });
      return {
        challengeId,
        sentTo: masked,
        expiresInSeconds: 300,
        demonstration: true,
        // Only present because this is a demo; a real provider never returns it.
        demoHint: `Demonstration code: ${DEMO_OTP}`
      };
    },

    async verifyOtp({ challengeId, code, subjectName }) {
      const challenge = challenges.get(challengeId);
      if (!challenge) {
        const err = new Error('That verification request has expired. Start again.');
        err.status = 400;
        err.code = 'CHALLENGE_EXPIRED';
        throw err;
      }
      if (String(code) !== DEMO_OTP) {
        const err = new Error('The code did not match. Check the SMS and try again.');
        err.status = 400;
        err.code = 'OTP_MISMATCH';
        throw err;
      }
      challenges.delete(challengeId);
      // A real provider returns a token plus the verified profile. The token is a
      // reference only: it is opaque and carries no identity data itself.
      return {
        provider: 'digilocker-demo',
        token: `DL-${Math.random().toString(36).slice(2, 18).toUpperCase()}`,
        verifiedName: subjectName,
        verifiedAt: new Date().toISOString(),
        // Explicitly false, and asserted in the tests: no raw national id.
        containsAadhaarNumber: false,
        demonstration: true
      };
    }
  };
}

/* ------------------------------------------------------------------ *
 * DocumentVault — DigiLocker-style issuer / requester flow
 * ------------------------------------------------------------------ */

/**
 * Mirrors the issuer/requester model: NiLaM is an *issuer* when it publishes a
 * statutory notice, and a *requester* when it pulls a document the citizen has
 * already had issued (7/12 extract, encumbrance certificate, PAN, etc.).
 *
 * Every issued document carries a timestamp and a version trail, which is what
 * gives the "legal validity and built-in version trail" claim something real
 * behind it. The vault reference is stored on the document row; the hash chain
 * in `document_revisions` remains the integrity layer underneath.
 */
export function documentVault() {
  if (MODE === 'live') {
    const base = process.env.NILAM_DIGILOCKER_URL;
    return {
      mode: 'live',
      isDemonstration: false,
      name: 'DigiLocker Issuer/Requester (API Setu)',
      async issue() {
        if (!base) throw new NotConfiguredError('DigiLocker vault', 'NILAM_DIGILOCKER_URL');
        throw new NotConfiguredError('DigiLocker issue', 'NILAM_DIGILOCKER_URL');
      },
      async fetch() {
        throw new NotConfiguredError('DigiLocker fetch', 'NILAM_DIGILOCKER_URL');
      }
    };
  }

  const issued = new Map();

  return {
    mode: 'demo',
    isDemonstration: true,
    name: 'DigiLocker Issuer/Requester (demonstration)',
    disclosure: 'Demonstration integration. Documents are held by NiLaM itself, not by DigiLocker.',

    /** Documents the demo citizen can pull rather than scan. */
    async catalogue() {
      return [
        { id: 'ROR_7_12', label: 'Record of Rights (7/12 extract)', issuer: 'Department of Land Records, Maharashtra' },
        { id: 'ENCUMBRANCE', label: 'Encumbrance Certificate', issuer: 'Department of Registration and Stamps' },
        { id: 'PROPERTY_TAX', label: 'Property Tax Receipt', issuer: 'Gram Panchayat / Municipal Corporation' },
        { id: 'PAN', label: 'PAN Card', issuer: 'Income Tax Department' },
        { id: 'SALE_DEED', label: 'Registered Sale Deed', issuer: 'Sub-Registrar Office' }
      ];
    },

    async fetch({ documentId, reference, requester }) {
      // A real fetch would return the issued document's bytes and metadata.
      const body =
        `DIGILOCKER (DEMONSTRATION) DOCUMENT FETCH\n\n` +
        `Document      : ${documentId}\n` +
        `Requested by  : ${requester}\n` +
        `Reference     : ${reference}\n` +
        `Fetched at    : ${new Date().toISOString()}\n\n` +
        `This is a demonstration document. It was not obtained from any government service.\n`;
      return {
        documentId,
        body,
        contentType: 'text/plain',
        issuer: 'demonstration',
        fetchedAt: new Date().toISOString(),
        demonstration: true
      };
    },

    async issue({ documentId, title, revision, body, issuedTo, issuedBy }) {
      const key = `${documentId}`;
      const history = issued.get(key) || [];
      history.push({ revision, at: new Date().toISOString(), by: issuedBy });
      issued.set(key, history);
      return {
        vaultReference: `VAULT-${Math.random().toString(36).slice(2, 14).toUpperCase()}`,
        documentId,
        title,
        revision,
        issuedTo,
        issuedBy,
        issuedAt: new Date().toISOString(),
        versionTrail: history,
        demonstration: true
      };
    }
  };
}

/* ------------------------------------------------------------------ *
 * LandMapProvider — Bhu-Naksha / Bhuvan style
 * ------------------------------------------------------------------ */

/**
 * Authoritative parcel lookup by survey number, plus basemap sources.
 *
 * In demo mode the parcel geometry comes from our own database, which is the
 * same GeoJSON the map draws, so the map is showing real stored geometry rather
 * than a mock sketch. In live mode the basemap and parcel authorities point at
 * Bhu-Naksha/Bhuvan and are configurable.
 */
export function landMapProvider() {
  const liveBase = process.env.NILAM_BHUVAN_URL;
  const liveWms = process.env.NILAM_BHUNAKSHA_WMS;

  return {
    mode: MODE,
    isDemonstration: MODE !== 'live',
    name: MODE === 'live' ? 'Bhu-Naksha / Bhuvan' : 'Bhu-Naksha / Bhuvan (demonstration)',
    disclosure:
      MODE === 'live'
        ? 'Basemap and parcel authority point at the configured Bhu-Naksha/Bhuvan endpoints.'
        : 'Demonstration mode. Parcel geometry is NiLaM\'s own stored PostGIS geometry; no Bhu-Naksha or Bhuvan service is contacted.',

    /** Basemap configuration the web map consumes. */
    basemap() {
      if (MODE === 'live' && liveWms) {
        return { kind: 'wms', url: liveWms, attribution: 'Bhuvan / Bhu-Naksha' };
      }
      // Offline: no tile source. The map draws vector parcels over a plain
      // ground colour, which is honest rather than showing someone else's tiles.
      return { kind: 'none', url: null, attribution: 'Vector parcels only (offline demonstration)' };
    },

    async lookupBySurveyNumber(_surveyNo) {
      if (MODE === 'live') {
        if (!liveBase) throw new NotConfiguredError('Bhu-Naksha lookup', 'NILAM_BHUVAN_URL');
        throw new NotConfiguredError('Bhu-Naksha lookup', 'NILAM_BHUVAN_URL');
      }
      // The server answers this from its own database; this adapter exists so the
      // call site is written against the real interface.
      return { source: 'nilam-database', demonstration: true };
    }
  };
}

/* ------------------------------------------------------------------ *
 * PaymentGateway — PFMS-shaped
 * ------------------------------------------------------------------ */

/**
 * Records a payment advice and its settlement. In demo mode the "transfer"
 * succeeds or fails deterministically so the treasury queue has both states.
 */
export function paymentGateway() {
  if (MODE === 'live') {
    const base = process.env.NILAM_PFMS_URL;
    return {
      mode: 'live',
      isDemonstration: false,
      name: 'PFMS',
      async advise() {
        if (!base) throw new NotConfiguredError('PFMS', 'NILAM_PFMS_URL');
        throw new NotConfiguredError('PFMS advise', 'NILAM_PFMS_URL');
      }
    };
  }

  return {
    mode: 'demo',
    isDemonstration: true,
    name: 'PFMS (demonstration)',
    disclosure: 'Demonstration integration. No funds move; only the advice and its outcome are recorded.',

    async advise({ caseNo, amountINR, payee, ifsc, accountMasked }) {
      const reference = `PFMS/${new Date().getFullYear()}/${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      return {
        reference,
        caseNo,
        amountINR,
        payee,
        ifsc,
        accountMasked,
        adviceAt: new Date().toISOString(),
        status: 'advice_issued',
        demonstration: true
      };
    },

    /**
     * Simulates the settlement that PFMS would report back.
     * A `fail` flag exists so the failed-payment rule and the treasury queue can
     * be demonstrated without waiting for a real bank return.
     */
    async settle({ reference, fail = false, reason = null }) {
      return {
        reference,
        status: fail ? 'failed' : 'paid',
        failureReason: fail ? (reason || 'Account closed — credit returned by the destination bank') : null,
        settledAt: new Date().toISOString(),
        demonstration: true
      };
    }
  };
}

/* ------------------------------------------------------------------ *
 * Notifier — SMS / WhatsApp
 * ------------------------------------------------------------------ */

export function notifier() {
  const sent = [];
  return {
    mode: MODE,
    isDemonstration: MODE !== 'live',
    name: MODE === 'live' ? 'SMS gateway' : 'SMS / WhatsApp (demonstration)',
    disclosure: 'Demonstration integration. Messages are recorded, not delivered.',

    async send({ to, template, params = {} }) {
      const body = renderTemplate(template, params);
      const record = { to, template, body, at: new Date().toISOString(), delivered: false, demonstration: true };
      sent.push(record);
      return record;
    },

    /** Everything the demo "sent", for the notification centre and the tests. */
    outbox() {
      return sent.slice();
    }
  };
}

/** Plain-language message templates. No jargon, and each says what to do next. */
const TEMPLATES = {
  'request.received': ({ reference }) =>
    `Your land request has been received. Reference ${reference}. We will tell you when the owner check is complete.`,
  'owner.verified': ({ surveyNo }) =>
    `The owner of Survey No. ${surveyNo} has been verified. The next step is checking the documents.`,
  'documents.needed': ({ surveyNo, documents }) =>
    `For Survey No. ${surveyNo}, we still need: ${documents}. You can fetch them in the app instead of uploading photos.`,
  'survey.assigned': ({ surveyNo, date }) =>
    `A field officer will visit Survey No. ${surveyNo} on ${date}. Please be present or send a representative.`,
  'survey.flagged': ({ surveyNo, reason }) =>
    `The survey of Survey No. ${surveyNo} needs a second look: ${reason}. No action is needed from you yet.`,
  'award.approved': ({ surveyNo, amount }) =>
    `The compensation of ${amount} for Survey No. ${surveyNo} has been approved. Payment will follow.`,
  'payment.paid': ({ surveyNo, amount, reference }) =>
    `${amount} for Survey No. ${surveyNo} has been credited to your registered account. Reference ${reference}.`,
  'payment.failed': ({ surveyNo }) =>
    `The payment for Survey No. ${surveyNo} was returned by the bank. Please check your account details in the app.`,
  'decision.made': ({ surveyNo }) =>
    `A decision has been recorded for your request on Survey No. ${surveyNo}. Open the app to see it.`
};

export function renderTemplate(template, params) {
  const fn = TEMPLATES[template];
  if (fn) return fn(params);
  return `NiLaM update: ${template} ${JSON.stringify(params)}`;
}

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

/* ------------------------------------------------------------------ *
 * Bundle
 * ------------------------------------------------------------------ */

/** All adapters, as the API service uses them. */
export function adapters() {
  return {
    mode: MODE,
    identity: identityProvider(),
    vault: documentVault(),
    landMap: landMapProvider(),
    payments: paymentGateway(),
    notifier: notifier()
  };
}

/** What the UI shows so a demonstration integration is never mistaken for live. */
export function integrationStatus() {
  const a = adapters();
  return {
    mode: MODE,
    isDemonstration: MODE !== 'live',
    label: MODE === 'live' ? 'Live integrations' : 'Demonstration data and integrations',
    detail:
      MODE === 'live'
        ? 'NiLaM is configured against live service endpoints.'
        : 'DigiLocker, Bhu-Naksha, Bhuvan and PFMS are replicated for demonstration. No government service is contacted and no Aadhaar number is stored.',
    components: [
      { id: 'identity', name: a.identity.name, demonstration: a.identity.isDemonstration },
      { id: 'vault', name: a.vault.name, demonstration: a.vault.isDemonstration },
      { id: 'map', name: a.landMap.name, demonstration: a.landMap.isDemonstration },
      { id: 'payments', name: a.payments.name, demonstration: a.payments.isDemonstration },
      { id: 'notifier', name: a.notifier.name, demonstration: a.notifier.isDemonstration }
    ]
  };
}
