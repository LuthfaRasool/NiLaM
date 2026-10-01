/**
 * NiLaM dashboard — the government and officer web application.
 *
 * Views are chosen by role, so an officer lands on their own queue rather than on
 * a generic dashboard. The four officer designations share the case workspace but
 * see different queues and different MIS summaries.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Icon, StatusChip, SlaChip, RiskChip, SeverityChip, Button, Card, Field, Input, Textarea,
  Metric, Alert, DemoBadge, Disclosure, ProgressBar, Empty, Skeleton, KeyValue, PageHeader,
  Timeline, Checklist, ParcelMap, useToasts
} from '../../../packages/ui/components.jsx';
import { api, setToken, getToken, ApiError } from '../../../packages/ui/api.js';

const rupees = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

const rupeesFull = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const initials = (name) => (name || '?').split(/\s+/).filter((w) => /[A-Za-z]/.test(w[0])).slice(-2).map((w) => w[0]).join('').toUpperCase();

/* ------------------------------------------------------------------ *
 * Login
 * ------------------------------------------------------------------ */

const DEMO_ACCOUNTS = [
  { username: 'lao', label: 'Land Acquisition Officer', who: 'Shri Prakash Deshmukh', hint: 'Acquisition queue, transitions, awards' },
  { username: 'registrar', label: 'Sub-Registrar', who: 'Smt. Kavita Meshram', hint: 'Purchase-track scrutiny' },
  { username: 'collector', label: 'Collector', who: 'Dr. Anjali Bhosale, IAS', hint: 'Approvals, disputes, at-risk cases' },
  { username: 'treasury', label: 'Treasury Officer', who: 'Shri Gajanan Tandulkar', hint: 'Payments due and failed' },
  { username: 'nhai', label: 'Government / NHAI', who: 'Shri Sudhir Nagpure', hint: 'Project progress and projected delays' },
  { username: 'auditor', label: 'Audit & Vigilance', who: 'Shri Mohan Khedkar', hint: 'Read-only ledger and case access' }
];

function Login({ onSignedIn, meta }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (u = username, p = password) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(u, p);
      setToken(res.token);
      onSignedIn(res.user, res.role);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nilam-login">
      <div className="nilam-login__card">
        <div className="nilam-login__brand">
          <div className="nilam-login__mark">NiLaM</div>
          <div className="nilam-login__sub">
            National Integrated Land Acquisition Module
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 8 }}>
            <DemoBadge detail={meta?.integrations?.detail} />
            <StatusChip tone="idle">{meta?.database || 'database'}</StatusChip>
          </div>
        </div>

        <Card title="Sign in">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Username" htmlFor="u" required>
              <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
            </Field>
            <Field label="Password" htmlFor="p" required>
              <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {error && <Alert tone="err" title="Could not sign in">{error}</Alert>}
            <div style={{ marginTop: 'var(--s4)' }}>
              <Button variant="primary" size="lg" block type="submit" loading={busy}>
                Sign in
              </Button>
            </div>
          </form>
        </Card>

        <div style={{ marginTop: 'var(--s5)' }}>
          <div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)', marginBottom: 'var(--s2)' }}>
            Demonstration accounts — password <code>nilam@2026</code>
          </div>
          <div className="nilam-login__accounts">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.username}
                className="nilam-login__account"
                onClick={() => {
                  setUsername(a.username);
                  setPassword('nilam@2026');
                  submit(a.username, 'nilam@2026');
                }}
                disabled={busy}
              >
                <span className="nilam-avatar" aria-hidden="true">{initials(a.who)}</span>
                <span className="nilam-login__who">
                  <span className="nilam-login__name">{a.who}</span>
                  <span className="nilam-login__role">{a.label} · {a.hint}</span>
                </span>
                <span aria-hidden="true" style={{ color: 'var(--ink-300)' }}><Icon.chevron /></span>
              </button>
            ))}
          </div>
        </div>

        <p style={{ marginTop: 'var(--s5)', fontSize: 'var(--size-xs)', color: 'var(--ink-500)', textAlign: 'center' }}>
          NiLaM · SIH26016 · Team CLANS
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Officer queue
 * ------------------------------------------------------------------ */

function QueueView({ onOpen, toast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('needs_action');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.queue());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="nilam-stack">
        <div className="nilam-grid nilam-grid--4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={112} />)}
        </div>
        <Skeleton height={320} />
      </div>
    );
  }
  if (!data) return <Empty title="Could not load your queue">Try again in a moment.</Empty>;

  const s = data.summary;
  const rows = filter === 'needs_action' ? data.needsAction : filter === 'overdue' ? data.all.filter((c) => c.sla.verdict === 'breached') : data.all;

  return (
    <div className="nilam-stack">
      <PageHeader
        crumb={`${data.role}${data.designation ? ` · ${data.designation.replace(/_/g, ' ')}` : ''}`}
        title={data.queueLabel}
        subtitle="Ordered by what needs action first, then by how close the statutory clock is to running out."
        actions={<Button onClick={load} loading={loading}>Refresh</Button>}
      />

      <div className="nilam-grid nilam-grid--4">
        <Metric label="Needs your action" value={s.needsAction} foot={`of ${s.total} open cases`} tone={s.needsAction ? 'warn' : undefined} />
        <Metric label="Past statutory clock" value={s.overdue} foot="SLA breached" tone={s.overdue ? 'err' : 'ok'} />
        <Metric label="Due soon" value={s.atRisk} foot="over 75% of the clock used" />
        <Metric label="Blocked by clearance" value={s.withClearanceBlockers} foot="cannot lawfully proceed" tone={s.withClearanceBlockers ? 'err' : undefined} />
      </div>

      {(s.paymentFailures > 0 || s.withFindings > 0) && (
        <Alert tone="warn" title="Attention needed">
          {s.paymentFailures > 0 && <div>{s.paymentFailures} payment(s) were returned by the bank and must be re-initiated.</div>}
          {s.withFindings > 0 && <div>{s.withFindings} case(s) have at least one discrepancy recorded by a field verifier.</div>}
        </Alert>
      )}

      <Card
        title={`${rows.length} case${rows.length === 1 ? '' : 's'}`}
        actions={
          <div className="nilam-row">
            <Button variant={filter === 'needs_action' ? 'primary' : 'secondary'} size={undefined} onClick={() => setFilter('needs_action')}>
              Needs action
            </Button>
            <Button variant={filter === 'overdue' ? 'primary' : 'secondary'} onClick={() => setFilter('overdue')}>
              Overdue
            </Button>
            <Button variant={filter === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('all')}>
              All
            </Button>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty title="Nothing in this list">
            {filter === 'needs_action' ? 'No case in your queue has an outstanding issue.' : 'Try another filter.'}
          </Empty>
        ) : (
          <div className="nilam-table-wrap">
            <table className="nilam-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Parcel</th>
                  <th>Landholder</th>
                  <th>Stage</th>
                  <th>SLA</th>
                  <th>Issues</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.caseId}>
                    <td>
                      <span className="nilam-table__case" onClick={() => onOpen(c.caseId)} role="button" tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && onOpen(c.caseId)}>
                        {c.caseNo}
                      </span>
                      {c.priority === 'high' && <div style={{ marginTop: 4 }}><StatusChip tone="warn">High priority</StatusChip></div>}
                    </td>
                    <td>
                      <div>Sy. No. {c.surveyNo}</div>
                      <div style={{ color: 'var(--ink-500)', fontSize: 'var(--size-xs)' }}>{c.village}, {c.taluka}</div>
                      <div style={{ color: 'var(--ink-500)', fontSize: 'var(--size-xs)' }}>{c.areaHectares.toFixed(4)} ha</div>
                    </td>
                    <td>
                      <div>{c.ownerName}</div>
                      {c.ownerCount > 1 && (
                        <div style={{ marginTop: 4 }}><StatusChip tone="warn">{c.ownerCount} co-owners</StatusChip></div>
                      )}
                    </td>
                    <td><StatusChip tone="info">{c.stageLabel}</StatusChip></td>
                    <td>
                      <SlaChip sla={c.sla} />
                      <div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)', marginTop: 4 }}>
                        {c.sla.elapsedDays} / {c.sla.slaDays} d
                      </div>
                    </td>
                    <td>
                      <div className="nilam-row" style={{ gap: 4 }}>
                        {c.clearanceBlockers > 0 && <StatusChip tone="err">{c.clearanceBlockers} clearance</StatusChip>}
                        {c.criticalFindings > 0 && <StatusChip tone="err">{c.criticalFindings} finding</StatusChip>}
                        {c.captureStatus === 'flagged' && <StatusChip tone="warn">Survey flagged</StatusChip>}
                        {c.paymentStatus === 'failed' && <StatusChip tone="err">Payment failed</StatusChip>}
                        {c.clearanceBlockers === 0 && c.criticalFindings === 0 && c.paymentStatus !== 'failed' && (
                          <span style={{ color: 'var(--ink-300)' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td><Button variant="quiet" onClick={() => onOpen(c.caseId)}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Case workspace
 * ------------------------------------------------------------------ */

function CaseView({ caseId, onBack, toast, refreshQueue }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setD(await api.caseDetail(caseId));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [caseId, toast]);

  useEffect(() => { load(); }, [load]);

  const doTransition = async (to) => {
    if (reason.trim().length < 10) {
      toast('Record a reason of at least 10 characters first.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await api.transition(caseId, to, reason.trim());
      toast(`Moved to ${res.stage.label}. Ledger entry #${res.ledgerEntry.seq}.`, 'ok');
      setReason('');
      setPending(null);
      await load();
      refreshQueue?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runModels = async () => {
    setBusy(true);
    try {
      const res = await api.runModels(caseId);
      toast(`CALM ${rupees(res.calm.estimateINR)} · PULSE ${res.pulse.probabilityPercent}% (${res.pulse.tier}).`, 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !d) return <div className="nilam-stack"><Skeleton height={80} /><Skeleton height={400} /></div>;
  if (!d) return <Empty title="Case not found">It may have been closed.</Empty>;

  const c = d.case;
  const p = d.parcel;

  return (
    <div className="nilam-stack">
      <PageHeader
        crumb={<span><Button variant="quiet" onClick={onBack}><Icon.back /> Back to queue</Button></span>}
        title={c.caseNo}
        subtitle={`${c.stageLabelFull} · ${c.legalRef}`}
        actions={
          <div className="nilam-row">
            <SlaChip sla={d.sla} />
            {d.pulse && <RiskChip tier={d.pulse.tier} />}
            <Button onClick={runModels} loading={busy}>Run CALM &amp; PULSE</Button>
          </div>
        }
      />

      {d.clearance && !d.clearance.cleared && (
        <Alert tone="err" title="This case cannot proceed to award yet">{d.clearance.headline}</Alert>
      )}

      {d.findings.length > 0 && (
        <Card title={`${d.findings.length} issue${d.findings.length === 1 ? '' : 's'} flagged by the rule engine`}>
          <div className="nilam-stack" style={{ gap: 'var(--s3)' }}>
            {d.findings.map((f, i) => (
              <div key={i} className="nilam-row" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                <SeverityChip severity={f.severity} />
                <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{f.title}</div>
                  <div style={{ fontSize: 'var(--size-sm)', color: 'var(--ink-500)' }}>{f.detail}</div>
                  <div style={{ fontSize: 'var(--size-sm)', color: 'var(--blue-600)', marginTop: 4 }}>{f.action}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="nilam-grid nilam-grid--wide">
        <div className="nilam-stack">
          <Card title="Parcel">
            {p ? (
              <>
                <ParcelMap parcel={p} capture={d.capture} />
                <div style={{ marginTop: 'var(--s4)' }}>
                  <KeyValue rows={[
                    ['Survey number', p.surveyNo],
                    ['Village', `${p.village}, ${p.taluka}`],
                    ['Area on record', `${p.recordAreaHectares.toFixed(4)} ha`],
                    ['Notified area', p.notifiedAreaHectares ? `${p.notifiedAreaHectares.toFixed(4)} ha` : null],
                    ['Area as surveyed', p.surveyedAreaHectares != null ? `${p.surveyedAreaHectares.toFixed(4)} ha` : null],
                    ['Land class', p.landClass],
                    ['Land use', p.landUse],
                    ['Guidance rate', `${rupeesFull(p.guidanceRate)} / ha`],
                    ['Irrigated', p.irrigated ? 'Yes' : 'No'],
                    ['Structures', p.structures],
                    ['Trees', p.trees ? String(p.trees) : null],
                    ['Distance to road', p.distanceToRoadM != null ? `${p.distanceToRoadM} m` : null],
                    ['Chainage', p.chainageStart != null ? `${p.chainageStart}–${p.chainageEnd} m` : null],
                    ['Record of Rights', p.rorOnFile ? `On file (${p.rorYear})` : 'Not on file']
                  ]} />
                </div>
              </>
            ) : <Empty title="No parcel linked" />}
          </Card>

          <Card title="Landholders">
            {d.owners.length === 0 ? <Empty title="No owner recorded" /> : (
              <div className="nilam-table-wrap">
                <table className="nilam-table">
                  <thead>
                    <tr><th>Name</th><th>Share</th><th>Identity</th><th>Consent</th></tr>
                  </thead>
                  <tbody>
                    {d.owners.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <div>{o.name}</div>
                          <div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>{o.guardian}</div>
                          {o.isLegalHeir && <div style={{ marginTop: 4 }}><StatusChip tone="info">Legal heir</StatusChip></div>}
                        </td>
                        <td className="nilam-table__num">{o.share}</td>
                        <td>
                          {o.identityVerified
                            ? <StatusChip tone="ok" title={o.identityProvider}>Verified</StatusChip>
                            : <StatusChip tone="warn">Not verified</StatusChip>}
                        </td>
                        <td>
                          <StatusChip tone={o.consentState === 'consented' ? 'ok' : o.consentState === 'objected' ? 'err' : 'warn'}>
                            {o.consentState}
                          </StatusChip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {d.capture && (
            <Card title={`Field verification — ${d.capture.ref}`}>
              <div className="nilam-row" style={{ marginBottom: 'var(--s4)' }}>
                <StatusChip tone={d.capture.status === 'verified' ? 'ok' : 'err'}>
                  {d.capture.status === 'verified' ? 'Verified' : 'Flagged for review'}
                </StatusChip>
                {d.capture.syncedOffline && <StatusChip tone="info">Synced from offline</StatusChip>}
                {d.capture.gpsFlagged && <StatusChip tone="warn">GPS concern</StatusChip>}
              </div>
              <KeyValue rows={[
                ['Corner count', String(d.capture.cornerCount)],
                ['Area as surveyed (server)', `${d.capture.surveyedAreaHectares.toFixed(4)} ha`],
                ['Area claimed by device', d.capture.clientAreaHectares != null ? `${d.capture.clientAreaHectares.toFixed(4)} ha` : null],
                ['Captured', new Date(d.capture.capturedAt).toLocaleString('en-IN')]
              ]} />
              <div style={{ marginTop: 'var(--s4)' }}>
                <Disclosure summary={`Corner coordinates (${d.capture.corners.length})`}>
                  <div className="nilam-table-wrap">
                    <table className="nilam-table">
                      <thead><tr><th>#</th><th>Latitude</th><th>Longitude</th><th>Accuracy</th><th>Heading</th></tr></thead>
                      <tbody>
                        {d.capture.corners.map((corner) => (
                          <tr key={corner.index}>
                            <td>{corner.index}</td>
                            <td className="nilam-table__num">{corner.lat.toFixed(7)}</td>
                            <td className="nilam-table__num">{corner.lon.toFixed(7)}</td>
                            <td className="nilam-table__num">{corner.accuracyM != null ? `±${corner.accuracyM} m` : '—'}</td>
                            <td className="nilam-table__num">{corner.headingDeg != null ? `${corner.headingDeg}°` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Disclosure>
              </div>
            </Card>
          )}

          {d.discrepancies.length > 0 && (
            <Card title={`Discrepancies (${d.discrepancies.length})`}>
              <div className="nilam-stack" style={{ gap: 'var(--s3)' }}>
                {d.discrepancies.map((x) => (
                  <div key={x.id} className="nilam-row" style={{ alignItems: 'flex-start' }}>
                    <SeverityChip severity={x.severity} />
                    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{x.type.replace(/_/g, ' ').toLowerCase()}</div>
                      <div style={{ fontSize: 'var(--size-sm)', color: 'var(--ink-500)' }}>{x.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Documents">
            {d.documents.length === 0 ? <Empty title="No documents on file" /> : (
              <div className="nilam-table-wrap">
                <table className="nilam-table">
                  <thead><tr><th>Document</th><th>Rev</th><th>Vault</th><th>Integrity</th></tr></thead>
                  <tbody>
                    {d.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td>
                          <div>{doc.typeLabel}</div>
                          <div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>{doc.title}</div>
                        </td>
                        <td className="nilam-table__num">{doc.revision}</td>
                        <td>{doc.issuedToVault ? <StatusChip tone="ok">Issued</StatusChip> : <StatusChip tone="idle">Held</StatusChip>}</td>
                        <td>
                          <Button variant="quiet" onClick={async () => {
                            try {
                              const v = await api.verifyDocument(doc.id);
                              toast(v.intact ? `${doc.typeLabel}: ${v.verdict}` : `INTEGRITY FAILURE: ${v.verdict}`, v.intact ? 'ok' : 'error');
                            } catch (err) { toast(err.message, 'error'); }
                          }}>Verify</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Case history">
            <Timeline
              steps={d.events.map((e) => ({
                id: e.id,
                label: e.to ? e.to.replace(/_/g, ' ') : e.action,
                done: true,
                explanation: `${e.actor || 'system'} · ${new Date(e.at).toLocaleString('en-IN')}${e.reason ? ` · ${e.reason}` : ''}`
              }))}
            />
          </Card>
        </div>

        <div className="nilam-stack">
          <Card title="Clearance checks" >
            <Checklist clearance={d.clearance} />
          </Card>

          <Card title="Compensation">
            <KeyValue rows={[
              ['Statutory floor', rupeesFull(d.compensation.statutoryFloor.total)],
              ['Market value', rupeesFull(d.compensation.statutoryFloor.marketValue)],
              ['Solatium (100%)', rupeesFull(d.compensation.statutoryFloor.solatium)],
              ['R&R entitlement', rupeesFull(d.compensation.statutoryFloor.rrEntitlement)],
              ['Paid so far', d.compensation.payment ? rupeesFull(d.compensation.payment.amountINR) : '—'],
              ['Outstanding', rupeesFull(d.compensation.outstanding)]
            ]} />

            {d.compensation.calm ? (
              <div style={{ marginTop: 'var(--s4)' }}>
                <Alert tone="demo" title={`CALM estimate: ${rupees(d.compensation.calm.amountINR)}`}>
                  Range {rupees(d.compensation.calm.lowINR)} – {rupees(d.compensation.calm.highINR)}
                  {d.compensation.calm.belowFloor && (
                    <div style={{ marginTop: 6, fontWeight: 600 }}>
                      The model is below the statutory floor. The floor governs.
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 'var(--size-xs)' }}>
                    {d.compensation.calm.label}
                  </div>
                </Alert>
                <div style={{ marginTop: 'var(--s3)' }}>
                  <Disclosure summary={`How this was reached (${d.compensation.calm.factors.length} factors)`}>
                    <table className="nilam-table">
                      <thead><tr><th>Factor</th><th className="nilam-table__num">Amount</th></tr></thead>
                      <tbody>
                        {d.compensation.calm.factors.map((f) => (
                          <tr key={f.id}>
                            <td>
                              {f.label}
                              {f.note && <div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>{f.note}</div>}
                            </td>
                            <td className="nilam-table__num">{rupeesFull(f.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 8, fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>
                      Items marked as demonstration are illustrative uplifts and are not statutory entitlements.
                    </div>
                  </Disclosure>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 'var(--s4)' }}>
                <Button onClick={runModels} loading={busy} block>Run CALM estimate</Button>
              </div>
            )}
          </Card>

          <Card title="Delay risk (PULSE)">
            {d.pulse ? (
              <>
                <div className="nilam-row" style={{ marginBottom: 'var(--s3)' }}>
                  <RiskChip tier={d.pulse.tier} />
                  <span style={{ fontSize: 'var(--size-xl)', fontWeight: 600, color: 'var(--ink-900)' }}>
                    {Math.round(d.pulse.probability * 100)}%
                  </span>
                </div>
                <div className="nilam-stack" style={{ gap: 'var(--s3)' }}>
                  {d.pulse.reasons.slice(0, 6).map((r) => (
                    <div key={r.id}>
                      {/*
                        The label and the weight share a row; the bar gets a row of
                        its own. All three on one line pushed the bar under the text.
                      */}
                      <div
                        className="nilam-row nilam-row--between"
                        style={{ fontSize: 'var(--size-sm)', gap: 'var(--s2)', alignItems: 'baseline' }}
                      >
                        <span style={{ flex: '1 1 auto', minWidth: 0 }}>{r.label}</span>
                        <span style={{ color: 'var(--ink-500)', flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}>
                          +{r.points}
                        </span>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <ProgressBar value={r.sharePercent / 100} tone={d.pulse.tier === 'high' ? 'err' : 'warn'} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 'var(--s4)' }}>
                  <Alert tone="info" title="Recommended">{d.pulse.recommendedAction}</Alert>
                </div>
                <div style={{ marginTop: 'var(--s3)', fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>
                  {d.pulse.label}
                </div>
              </>
            ) : (
              <Button onClick={runModels} loading={busy} block>Run PULSE assessment</Button>
            )}
          </Card>

          {d.nextStages.length > 0 && (
            <Card title="Move this case forward">
              <Field label="Reason for the record" hint="Recorded on the case file and in the audit ledger. At least 10 characters." required htmlFor="reason">
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Section 15 objections heard; the measurement dispute was resolved in the landholder's presence."
                  invalid={Boolean(pending) && reason.trim().length < 10}
                  error={Boolean(pending) && reason.trim().length < 10 ? 'A reason of at least 10 characters is required.' : null}
                />
              </Field>
              <div className="nilam-stack" style={{ gap: 'var(--s2)' }}>
                {d.nextStages.map((n) => (
                  <div key={n.stageId}>
                    <Button
                      variant="primary"
                      block
                      disabled={!n.allowed || busy}
                      onClick={() => { setPending(n.stageId); doTransition(n.stageId); }}
                      title={n.allowed ? `Move to ${n.label}` : n.reason}
                    >
                      {n.label}
                    </Button>
                    {!n.allowed && (
                      <div style={{ fontSize: 'var(--size-xs)', color: 'var(--err-700)', marginTop: 4 }}>{n.reason}</div>
                    )}
                    {n.allowed && n.legalRef && (
                      <div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)', marginTop: 4 }}>{n.legalRef}</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {d.missingDocuments.length > 0 && (
            <Alert tone="warn" title="Missing documents">
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {d.missingDocuments.map((m) => <li key={m.id}>{m.label}</li>)}
              </ul>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Government overview
 * ------------------------------------------------------------------ */

function OverviewView({ onOpen }) {
  const [data, setData] = useState(null);
  const [models, setModels] = useState(null);

  useEffect(() => {
    api.overview().then(setData).catch(() => {});
    api.models().then(setModels).catch(() => {});
  }, []);

  if (!data) return <div className="nilam-stack"><Skeleton height={112} /><Skeleton height={340} /></div>;
  const t = data.totals;

  return (
    <div className="nilam-stack">
      <PageHeader
        title="Project overview"
        subtitle="Progress, cost and projected delays across acquisition projects. Figures are computed from the case records, not entered by hand."
      />

      <div className="nilam-grid nilam-grid--4">
        <Metric label="Parcels" value={t.parcels} foot="under acquisition" />
        <Metric label="Compensation payable" value={rupees(t.payableINR)} />
        <Metric label="Disbursed" value={rupees(t.paidINR)} tone="ok" />
        <Metric label="Projected delays" value={t.atRisk + t.breached} foot={`${t.breached} already past the clock`} tone={t.breached ? 'err' : 'warn'} />
      </div>

      {t.flagged > 0 && (
        <Alert tone="warn" title={`${t.flagged} survey${t.flagged === 1 ? '' : 's'} flagged`}>
          These parcels have a measured area or boundary that disagrees with the record and need a decision before the award.
        </Alert>
      )}

      {data.projects.map((p) => (
        <Card key={p.id} title={p.name} actions={<StatusChip tone="info">{p.code}</StatusChip>}>
          <KeyValue rows={[
            ['Requesting agency', p.agency],
            ['District', p.district],
            ['Sanctioned budget', p.budgetINR ? rupees(p.budgetINR) : '—'],
            ['Parcels', String(p.parcelCount)],
            ['Compensation payable', rupees(p.payableINR)],
            ['Disbursed', `${rupees(p.paidINR)} (${p.payableINR ? Math.round((p.paidINR / p.payableINR) * 100) : 0}%)`]
          ]} />
          <div style={{ marginTop: 'var(--s5)' }}>
            <div style={{ fontSize: 'var(--size-sm)', fontWeight: 600, marginBottom: 'var(--s3)' }}>Cases by stage</div>
            <div className="nilam-table-wrap">
              <table className="nilam-table">
                <thead><tr><th>Stage</th><th className="nilam-table__num">Cases</th></tr></thead>
                <tbody>
                  {Object.entries(p.byStage).sort((a, b) => b[1] - a[1]).map(([stage, n]) => (
                    <tr key={stage}>
                      <td>{stage.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="nilam-table__num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ))}

      {models?.report && (
        <Card title="Model card">
          <Alert tone="demo" title="Demonstration models, not trained models">
            {models.report.training}. {models.report.data_provenance}
          </Alert>
          <div style={{ marginTop: 'var(--s4)' }}>
            <Disclosure summary="What CALM and PULSE actually are">
              <KeyValue rows={[
                ['CALM', models.report.calm?.name],
                ['CALM target', models.report.calm?.target],
                ['PULSE', models.report.pulse?.name],
                ['PULSE target', models.report.pulse?.target],
                ['Libraries', 'scikit-learn, LightGBM, XGBoost and SHAP are unavailable offline; neither model is trained, so none are required.']
              ]} />
              <div style={{ marginTop: 'var(--s4)' }}>
                <div style={{ fontSize: 'var(--size-sm)', fontWeight: 600, marginBottom: 'var(--s2)' }}>PULSE signal weights</div>
                <table className="nilam-table">
                  <thead><tr><th>Signal</th><th className="nilam-table__num">Points</th></tr></thead>
                  <tbody>
                    {(models.report.pulse?.signals || []).map((s) => (
                      <tr key={s.id}>
                        <td>{s.label}{s.per_unit ? ' (per unit, capped)' : ''}</td>
                        <td className="nilam-table__num">{s.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Disclosure>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Citizen view
 *
 * Deliberately not the officer view with fields hidden: a landholder needs plain
 * language, what happens next, and one clear action.
 * ------------------------------------------------------------------ */

function CitizenView({ onOpen, toast, onRefresh }) {
  const [cases, setCases] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.myCases();
      setCases(r.cases);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const respond = async (caseId, decision, note) => {
    try {
      const r = await api.consent(caseId, decision, note);
      toast(r.message, 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error) return <Alert tone="err" title="Could not load your cases">{error}</Alert>;
  if (!cases) return <div className="nilam-stack"><Skeleton height={140} /><Skeleton height={260} /></div>;
  if (!cases.length) {
    return (
      <Empty title="You have no land cases yet">
        When land you own is proposed for acquisition, or you raise a purchase request, it will appear here.
      </Empty>
    );
  }

  return (
    <div className="nilam-stack">
      <PageHeader
        title="Your land"
        subtitle="Each case shows where it has reached, what it means for you, and anything we need from you."
        actions={<Button onClick={load}>Refresh</Button>}
      />

      {cases.map((c) => (
        <Card key={c.caseNo} title={c.caseNo} actions={<StatusChip tone="info">{c.stageLabel}</StatusChip>}>
          <Alert tone="info" title="What this means">{c.whatThisMeans}</Alert>

          {c.needsAction.length > 0 && (
            <div style={{ marginTop: 'var(--s4)' }}>
              {c.needsAction.map((n) => (
                <Alert key={n.id} tone="warn" title={n.title}>
                  {n.body}
                </Alert>
              ))}
            </div>
          )}

          <div style={{ marginTop: 'var(--s4)' }}>
            <KeyValue rows={[
              ['Survey number', c.parcel?.surveyNo],
              ['Village', c.parcel ? `${c.parcel.village}, ${c.parcel.taluka}` : null],
              ['Area on record', c.parcel ? `${c.parcel.recordAreaHectares.toFixed(4)} ha` : null],
              ['Area measured', c.parcel?.surveyedAreaHectares != null ? `${c.parcel.surveyedAreaHectares.toFixed(4)} ha` : 'Not yet measured'],
              ['Compensation payable', c.compensation?.statutoryFloorFormatted],
              ['Payment', c.payment ? c.payment.status : 'Not yet paid']
            ]} />
          </div>

          {c.compensation?.estimate && (
            <div style={{ marginTop: 'var(--s4)' }}>
              <Alert tone="demo" title={`Estimated at ${rupees(c.compensation.estimate.amountINR)}`}>
                Range {rupees(c.compensation.estimate.lowINR)} – {rupees(c.compensation.estimate.highINR)}.
                The amount finally payable is never less than {c.compensation.statutoryFloorFormatted}.
                <div style={{ fontSize: 'var(--size-xs)', marginTop: 4 }}>{c.compensation.estimate.label}</div>
              </Alert>
            </div>
          )}

          <div style={{ marginTop: 'var(--s5)' }}>
            <div style={{ fontSize: 'var(--size-sm)', fontWeight: 600, marginBottom: 'var(--s3)' }}>Progress</div>
            <Timeline steps={c.steps} />
          </div>

          {c.needsAction.some((n) => n.id === 'consent') && (
            <div style={{ marginTop: 'var(--s4)' }} className="nilam-stack">
              <Button variant="primary" size="lg" block onClick={() => respond(c.id, 'consented', '')}>
                I agree to the offer
              </Button>
              <Button size="lg" block onClick={() => {
                const note = window.prompt('Please describe the ground for your objection (at least 10 characters).');
                if (note) respond(c.id, 'objected', note);
              }}>
                I want to object
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Field verifier view
 * ------------------------------------------------------------------ */

function FieldView({ toast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.assignments()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <Alert tone="err" title="Could not load assignments">{error}</Alert>;
  if (!data) return <div className="nilam-stack"><Skeleton height={140} /><Skeleton height={260} /></div>;

  return (
    <div className="nilam-stack">
      <PageHeader
        title="Field assignments"
        subtitle={`Capture the boundary corner by corner. At least ${data.minCorners} corners, and readings must be within ±${data.accuracyMaxM} m.`}
      />
      <Alert tone="info" title="Capture happens in the field app">
        This is the web dashboard. Corner capture, offline queueing and sync run in the NiLaM Field application.
      </Alert>
      {data.assignments.length === 0 ? (
        <Empty title="Nothing assigned to you">New survey assignments will appear here.</Empty>
      ) : (
        <Card title={`${data.assignments.length} assignment${data.assignments.length === 1 ? '' : 's'}`}>
          <div className="nilam-table-wrap">
            <table className="nilam-table">
              <thead><tr><th>Case</th><th>Parcel</th><th>Landholder</th><th>Area on record</th><th>Previous captures</th></tr></thead>
              <tbody>
                {data.assignments.map((a) => (
                  <tr key={a.caseId}>
                    <td className="nilam-table__case">{a.caseNo}</td>
                    <td>Sy. No. {a.surveyNo}<div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>{a.village}, {a.taluka}</div></td>
                    <td>{a.ownerName}</td>
                    <td className="nilam-table__num">{a.recordAreaHectares.toFixed(4)} ha</td>
                    <td className="nilam-table__num">{a.captureCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Audit ledger
 * ------------------------------------------------------------------ */

function AuditView({ toast }) {
  const [entries, setEntries] = useState(null);
  const [verdict, setVerdict] = useState(null);

  const load = useCallback(async () => {
    try {
      const [a, v] = await Promise.all([api.audit(150), api.verifyAudit()]);
      setEntries(a.entries);
      setVerdict(v);
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="nilam-stack">
      <PageHeader
        title="Audit ledger"
        subtitle="Append-only. Each entry commits to its predecessor's hash, so altering any past entry invalidates every hash after it."
        actions={<Button onClick={load}>Re-verify</Button>}
      />
      {verdict && (
        <Alert tone={verdict.intact ? 'ok' : 'err'} title={verdict.intact ? 'Chain intact' : 'TAMPERING DETECTED'}>
          {verdict.entries} entries. {verdict.verdict}
          <div style={{ fontSize: 'var(--size-xs)', marginTop: 4 }}>Head: <code>{verdict.head}</code></div>
        </Alert>
      )}
      <Card title="Recent entries">
        {!entries ? <Skeleton height={300} /> : (
          <div className="nilam-table-wrap">
            <table className="nilam-table">
              <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Subject</th><th>Hash</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.seq}>
                    <td className="nilam-table__num">{e.seq}</td>
                    <td>{new Date(e.at).toLocaleString('en-IN')}</td>
                    <td>{e.actor}<div style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>{e.role}</div></td>
                    <td><StatusChip tone="info">{e.action}</StatusChip></td>
                    <td style={{ fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>{e.subject}</td>
                    <td style={{ fontFamily: 'var(--font-num)', fontSize: 11 }}>{String(e.hash).slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

function SearchBox({ onOpen }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.search(q.trim());
        setResults(r.results);
        setOpen(true);
      } catch { /* a failed search should not interrupt typing */ }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div style={{ position: 'relative', flex: '1 1 340px', maxWidth: 460 }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-300)' }} aria-hidden="true"><Icon.search /></span>
        <Input
          value={q}
          placeholder="Search case no., survey no., owner or village"
          aria-label="Search"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results && setOpen(true)}
          style={{ paddingLeft: 34 }}
        />
      </div>
      {open && results && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 40,
          background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)',
          boxShadow: 'var(--e2)', maxHeight: 360, overflowY: 'auto'
        }}>
          {results.length === 0 ? (
            <div style={{ padding: 'var(--s4)', fontSize: 'var(--size-sm)', color: 'var(--ink-500)' }}>No case matches “{q}”.</div>
          ) : results.map((r) => (
            <button
              key={r.caseId}
              className="nilam-nav__item"
              style={{ borderRadius: 0, width: '100%' }}
              onClick={() => { onOpen(r.caseId); setOpen(false); setQ(''); }}
            >
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 'var(--size-sm)' }}>{r.caseNo}</span>
                <span style={{ display: 'block', fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>
                  Sy. No. {r.surveyNo} · {r.village} · {r.ownerName}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shell and routing
 * ------------------------------------------------------------------ */

export default function App() {
  const [meta, setMeta] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [view, setView] = useState('queue');
  const [caseId, setCaseId] = useState(null);
  const { push, view: toastView } = useToasts();

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});

    /*
     * Demo deep-linking: `?as=<username>` signs in as that account, and
     * `?view=case` opens the first case on their queue.
     *
     * This exists so a reviewer — or the screenshot harness — can reach an
     * authenticated screen in one URL. It is a demonstration affordance and is
     * disabled when NILAM_DEMO_LINKS=0 is baked into the build.
     */
    const params = new URLSearchParams(window.location.search);
    const as = params.get('as');
    const wantCase = params.get('view') === 'case';
    const demoLinks = window.__NILAM_DEMO_LINKS !== false;

    const enter = async (u, r) => {
      setUser(u);
      setRole(r);
      if (wantCase && ['officer', 'auditor'].includes(u.role)) {
        try {
          const q = await api.queue();
          const first = q.needsAction[0] || q.all[0];
          if (first) {
            setCaseId(first.caseId);
            setView('case');
            return;
          }
        } catch { /* fall through to the default view */ }
      }
      setView(
        u.role === 'government' ? 'overview'
          : u.role === 'citizen' ? 'myland'
            : u.role === 'field_verifier' ? 'field'
              : 'queue'
      );
    };

    if (as && demoLinks) {
      api.login(as, 'nilam@2026')
        .then(async (res) => {
          setToken(res.token);
          await enter(res.user, res.role);
        })
        .catch(() => {});
      return;
    }

    // Resume an existing session so a refresh does not sign the user out.
    if (getToken()) {
      api.session()
        .then((s) => enter(s.user, s.role))
        .catch(() => setToken(null));
    }
  }, []);

  const onSignedIn = useCallback((u, r) => {
    setUser(u);
    setRole(r);
    setView(
      u.role === 'government' ? 'overview'
        : u.role === 'citizen' ? 'myland'
          : u.role === 'field_verifier' ? 'field'
            : 'queue'
    );
    push(`Signed in as ${u.name}`, 'ok');
  }, [push]);

  const openCase = useCallback((id) => { setCaseId(id); setView('case'); }, []);
  const refreshQueue = useCallback(() => {}, []);

  const NAV = useMemo(() => {
    if (!user) return [];
    const items = [];
    if (['officer', 'auditor'].includes(user.role)) {
      items.push({ id: 'queue', label: 'My queue', icon: Icon.layers });
    }
    if (user.role === 'government') {
      items.push({ id: 'overview', label: 'Project overview', icon: Icon.chart });
    }
    if (user.role === 'citizen') {
      items.push({ id: 'myland', label: 'My land', icon: Icon.home });
    }
    if (user.role === 'field_verifier') {
      items.push({ id: 'field', label: 'Assignments', icon: Icon.pin });
    }
    if (['officer', 'government', 'auditor'].includes(user.role)) {
      items.push({ id: 'audit', label: 'Audit ledger', icon: Icon.shield });
    }
    return items;
  }, [user]);

  if (!user) return <Login onSignedIn={onSignedIn} meta={meta} />;

  return (
    <div className="nilam-app">
      <div className="nilam-strip" />
      <header className="nilam-header">
        <div className="nilam-brand">
          <span className="nilam-brand__mark">NiLaM</span>
          <span className="nilam-brand__sub">National Integrated Land Acquisition Module</span>
        </div>
        <div className="nilam-header__spacer" />
        <SearchBox onOpen={openCase} />
        <DemoBadge detail={meta?.integrations?.detail} />
        <div className="nilam-header__user">
          <span className="nilam-avatar" aria-hidden="true">{initials(user.name)}</span>
          <span style={{ lineHeight: 1.2 }}>
            <span style={{ display: 'block', fontWeight: 600, color: 'var(--ink-900)' }}>{user.name}</span>
            <span style={{ display: 'block', fontSize: 'var(--size-xs)', color: 'var(--ink-500)' }}>{role?.label}</span>
          </span>
          <Button variant="quiet" title="Sign out" onClick={async () => {
            try { await api.logout(); } catch { /* signing out locally is enough */ }
            setToken(null);
            setUser(null);
            setRole(null);
          }}><Icon.logout /></Button>
        </div>
      </header>

      <div className="nilam-body">
        <nav className="nilam-nav" aria-label="Sections">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nilam-nav__item${view === n.id ? ' nilam-nav__item--active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <span aria-hidden="true"><n.icon /></span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <main className="nilam-main">
          <div className="nilam-page">
            {view === 'queue' && <QueueView onOpen={openCase} toast={push} />}
            {view === 'case' && <CaseView caseId={caseId} onBack={() => setView('queue')} toast={push} refreshQueue={refreshQueue} />}
            {view === 'overview' && <OverviewView onOpen={openCase} />}
            {view === 'myland' && <CitizenView onOpen={openCase} toast={push} />}
            {view === 'field' && <FieldView toast={push} />}
            {view === 'audit' && <AuditView toast={push} />}
          </div>
        </main>
      </div>
      {toastView}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mount
 *
 * Without this the bundle defines <App> and stops, which renders a blank page.
 * The build succeeded and Chrome reported no errors, so nothing else caught it 
 * only looking at the screenshot did.
 * ------------------------------------------------------------------ */

const container = document.getElementById('root');
if (container) {
  // Remove the static fallback panel so a successful start never shows it. This
  // replaces the inline script an earlier build used, which the CSP correctly
  // refused to execute.
  const boot = document.getElementById('boot-error');
  if (boot) boot.remove();
  createRoot(container).render(<App />);
} else {
  const boot = document.getElementById('boot-error');
  const detail = document.getElementById('boot-error-detail');
  if (boot) boot.hidden = false;
  if (detail) detail.textContent = 'The page has no #root element to mount into.';
}
