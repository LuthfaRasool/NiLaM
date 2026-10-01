/**
 * NiLaM Citizen Mobile App
 *
 * A clean, DigiLocker-inspired mobile-first app for citizens to:
 * - Track their land acquisition / purchase cases
 * - View plain-language status and what happens next
 * - Give consent or file objections
 * - View compensation details
 * - See a timeline of all events
 *
 * This is served at /citizen/ and is a separate entry point from the
 * officer dashboard.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

/* ------------------------------------------------------------------ *
 * Minimal API client (self-contained so this app is independent)
 * ------------------------------------------------------------------ */

const TOKEN_KEY = 'nilam.citizen.token';
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { token = null; }

function setToken(v) {
  token = v;
  try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

async function apiFetch(method, path, body) {
  const h = { Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

const api = {
  login: (u, p) => apiFetch('POST', '/api/auth/login', { username: u, password: p }),
  meta: () => apiFetch('GET', '/api/meta'),
  myCases: () => apiFetch('GET', '/api/my/cases'),
  myCase: (id) => apiFetch('GET', `/api/my/cases/${id}`),
  consent: (id, decision, note) => apiFetch('POST', `/api/my/cases/${id}/consent`, { decision, note }),
  createRequest: (payload) => apiFetch('POST', '/api/requests', payload),
  notifications: () => apiFetch('GET', '/api/notifications'),
};

/* ------------------------------------------------------------------ *
 * Formatters
 * ------------------------------------------------------------------ */

const rupees = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

/* ------------------------------------------------------------------ *
 * Icons (inline SVG, no external deps)
 * ------------------------------------------------------------------ */

const Icons = {
  home: () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  file: () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  bell: () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
  user: () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  check: () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  alert: () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  clock: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  back: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>,
  logout: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

/* ------------------------------------------------------------------ *
 * Login Screen — DigiLocker inspired
 * ------------------------------------------------------------------ */

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const DEMO = [
    { id: 'ramesh', name: 'Ramesh Wankhede', hint: 'Landowner — 2 acquisition cases' },
    { id: 'sunita', name: 'Sunita Jadhav', hint: 'Landowner — purchase request' },
    { id: 'vithal', name: 'Vithal Meshram', hint: 'Landowner — 1 case, consent pending' },
  ];

  const submit = async (u = username, p = password) => {
    setBusy(true); setError(null);
    try {
      const r = await api.login(u, p);
      setToken(r.token);
      onLogin(r.user, r.role);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="ctz-login">
      {/* Tricolour strip */}
      <div className="ctz-tricolour" />

      <div className="ctz-login__body">
        {/* Brand */}
        <div className="ctz-login__brand">
          <div className="ctz-login__emblem">🏛</div>
          <h1 className="ctz-login__title">NiLaM</h1>
          <p className="ctz-login__subtitle">National Integrated Land Acquisition Module</p>
          <p className="ctz-login__ministry">Ministry of Rural Development · Government of India</p>
        </div>

        {/* Login form */}
        <div className="ctz-card">
          <h2 className="ctz-card__title">Sign in to your account</h2>
          {error && <div className="ctz-alert ctz-alert--err">{error}</div>}
          <form onSubmit={e => { e.preventDefault(); submit(); }}>
            <label className="ctz-field">
              <span className="ctz-field__label">Username or Aadhaar</span>
              <input className="ctz-input" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" autoComplete="username" />
            </label>
            <label className="ctz-field">
              <span className="ctz-field__label">Password / OTP</span>
              <input className="ctz-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" />
            </label>
            <button className="ctz-btn ctz-btn--primary" type="submit" disabled={busy || !username || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="ctz-card__note">
            <Icons.alert /> This is a demonstration environment. No real identity data is processed.
          </p>
        </div>

        {/* Quick access */}
        <div className="ctz-demo-section">
          <p className="ctz-demo-section__label">Demo accounts · password <code>nilam@2026</code></p>
          {DEMO.map(d => (
            <button key={d.id} className="ctz-demo-account" onClick={() => submit(d.id, 'nilam@2026')}>
              <div className="ctz-demo-account__avatar">{d.name.split(' ').map(w => w[0]).join('')}</div>
              <div>
                <div className="ctz-demo-account__name">{d.name}</div>
                <div className="ctz-demo-account__hint">{d.hint}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Home Tab — My Cases
 * ------------------------------------------------------------------ */

function HomeTab({ cases, loading, onRefresh, onOpenCase }) {
  if (loading) return <div className="ctz-skeleton-list">{[1,2,3].map(i => <div key={i} className="ctz-skeleton" />)}</div>;

  return (
    <div className="ctz-tab-content">
      <div className="ctz-section-header">
        <h2>My Land</h2>
        <button className="ctz-btn ctz-btn--ghost" onClick={onRefresh}>Refresh</button>
      </div>

      {(!cases || cases.length === 0) ? (
        <div className="ctz-empty">
          <div className="ctz-empty__icon">📋</div>
          <h3>No cases yet</h3>
          <p>When land you own is proposed for acquisition, or you raise a purchase request, it will appear here.</p>
        </div>
      ) : (
        <div className="ctz-case-list">
          {cases.map(c => (
            <button key={c.caseNo} className="ctz-case-card" onClick={() => onOpenCase(c)}>
              <div className="ctz-case-card__top">
                <span className={`ctz-status-pill ctz-status-pill--${stageTone(c.stage)}`}>{c.stageLabel}</span>
                {c.sla?.state === 'breached' && <span className="ctz-status-pill ctz-status-pill--err">Overdue</span>}
              </div>
              <h3 className="ctz-case-card__id">{c.caseNo}</h3>
              <div className="ctz-case-card__details">
                <span>Sy. No. {c.parcel?.surveyNo}</span>
                <span>{c.parcel?.village}, {c.parcel?.taluka}</span>
              </div>
              <div className="ctz-case-card__details">
                <span>{c.parcel?.recordAreaHectares?.toFixed(4)} ha</span>
                {c.compensation?.statutoryFloorFormatted && <span className="ctz-case-card__amount">{c.compensation.statutoryFloorFormatted}</span>}
              </div>
              {c.needsAction?.length > 0 && (
                <div className="ctz-case-card__badge">
                  <Icons.alert /> {c.needsAction.length} action{c.needsAction.length > 1 ? 's' : ''} needed
                </div>
              )}
              <div className="ctz-case-card__arrow">›</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function stageTone(stage) {
  if (!stage) return 'idle';
  const s = stage.toLowerCase();
  if (s.includes('award') || s.includes('complet') || s.includes('paid')) return 'ok';
  if (s.includes('disput') || s.includes('object')) return 'warn';
  return 'info';
}

/* ------------------------------------------------------------------ *
 * Case Detail Screen
 * ------------------------------------------------------------------ */

function CaseDetailScreen({ caseData, onBack, onConsent }) {
  const c = caseData;

  return (
    <div className="ctz-detail">
      <div className="ctz-detail__header">
        <button className="ctz-btn ctz-btn--icon" onClick={onBack}><Icons.back /></button>
        <h2>{c.caseNo}</h2>
      </div>

      {/* Status banner */}
      <div className={`ctz-status-banner ctz-status-banner--${stageTone(c.stage)}`}>
        <div className="ctz-status-banner__stage">{c.stageLabel}</div>
        <div className="ctz-status-banner__what">{c.whatThisMeans}</div>
      </div>

      {/* Actions needed */}
      {c.needsAction?.length > 0 && (
        <div className="ctz-section">
          <h3 className="ctz-section__title"><Icons.alert /> Action Required</h3>
          {c.needsAction.map(n => (
            <div key={n.id} className="ctz-alert ctz-alert--warn">
              <strong>{n.title}</strong>
              <p>{n.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Land details */}
      <div className="ctz-section">
        <h3 className="ctz-section__title">Land Details</h3>
        <div className="ctz-kv-list">
          <KV label="Survey number" value={c.parcel?.surveyNo} />
          <KV label="Village" value={c.parcel ? `${c.parcel.village}, ${c.parcel.taluka}` : '-'} />
          <KV label="Area on record" value={c.parcel ? `${c.parcel.recordAreaHectares?.toFixed(4)} ha` : '-'} />
          <KV label="Area measured" value={c.parcel?.surveyedAreaHectares != null ? `${c.parcel.surveyedAreaHectares.toFixed(4)} ha` : 'Not yet measured'} />
          <KV label="Land class" value={c.parcel?.landClass} />
        </div>
      </div>

      {/* Compensation */}
      {c.compensation && (
        <div className="ctz-section">
          <h3 className="ctz-section__title">Compensation</h3>
          <div className="ctz-comp-card">
            <div className="ctz-comp-card__amount">{c.compensation.statutoryFloorFormatted || 'Pending calculation'}</div>
            <div className="ctz-comp-card__label">Statutory minimum payable</div>
            {c.compensation.estimate && (
              <div className="ctz-comp-card__estimate">
                <span>Estimated: {rupees(c.compensation.estimate.amountINR)}</span>
                <span className="ctz-comp-card__range">Range: {rupees(c.compensation.estimate.lowINR)} – {rupees(c.compensation.estimate.highINR)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      {c.steps && c.steps.length > 0 && (
        <div className="ctz-section">
          <h3 className="ctz-section__title">Progress</h3>
          <div className="ctz-timeline">
            {c.steps.map((s, i) => (
              <div key={i} className={`ctz-timeline__step ${s.done ? 'ctz-timeline__step--done' : s.current ? 'ctz-timeline__step--current' : ''}`}>
                <div className="ctz-timeline__dot">
                  {s.done ? <Icons.check /> : <span>{i + 1}</span>}
                </div>
                <div className="ctz-timeline__content">
                  <div className="ctz-timeline__label">{s.label}</div>
                  {s.date && <div className="ctz-timeline__date">{s.date}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment status */}
      {c.payment && (
        <div className="ctz-section">
          <h3 className="ctz-section__title">Payment</h3>
          <div className="ctz-kv-list">
            <KV label="Status" value={c.payment.status} />
            {c.payment.amount && <KV label="Amount" value={rupees(c.payment.amount)} />}
          </div>
        </div>
      )}

      {/* Consent / Objection */}
      {c.needsAction?.some(n => n.id === 'consent') && (
        <div className="ctz-section ctz-section--actions">
          <h3 className="ctz-section__title">Your Response</h3>
          <p className="ctz-section__desc">Please review the offer above and respond. Your response is legally recorded.</p>
          <div className="ctz-action-buttons">
            <button className="ctz-btn ctz-btn--primary ctz-btn--lg" onClick={() => onConsent(c.id, 'consented', '')}>
              <Icons.check /> I agree to the offer
            </button>
            <button className="ctz-btn ctz-btn--outline ctz-btn--lg" onClick={() => {
              const note = prompt('Please describe the ground for your objection (at least 10 characters):');
              if (note && note.length >= 10) onConsent(c.id, 'objected', note);
              else if (note) alert('Please provide at least 10 characters.');
            }}>
              <Icons.alert /> I want to object
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div className="ctz-kv">
      <span className="ctz-kv__label">{label}</span>
      <span className="ctz-kv__value">{value || '—'}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Notifications Tab
 * ------------------------------------------------------------------ */

function NotificationsTab({ user }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.notifications().then(r => setItems(r.notifications || [])).catch(() => setItems([]));
  }, []);

  if (!items) return <div className="ctz-skeleton-list">{[1,2].map(i => <div key={i} className="ctz-skeleton" />)}</div>;

  return (
    <div className="ctz-tab-content">
      <div className="ctz-section-header">
        <h2>Notifications</h2>
      </div>
      {items.length === 0 ? (
        <div className="ctz-empty">
          <div className="ctz-empty__icon">🔔</div>
          <h3>All caught up</h3>
          <p>You'll be notified when there's an update on your cases.</p>
        </div>
      ) : (
        <div className="ctz-notif-list">
          {items.map((n, i) => (
            <div key={i} className={`ctz-notif ${n.read ? '' : 'ctz-notif--unread'}`}>
              <div className="ctz-notif__icon"><Icons.bell /></div>
              <div>
                <div className="ctz-notif__title">{n.title}</div>
                <div className="ctz-notif__body">{n.body}</div>
                <div className="ctz-notif__time">{n.at ? new Date(n.at).toLocaleDateString('en-IN') : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Profile Tab
 * ------------------------------------------------------------------ */

function ProfileTab({ user, onLogout }) {
  return (
    <div className="ctz-tab-content">
      <div className="ctz-profile">
        <div className="ctz-profile__avatar">{user.name?.split(' ').map(w => w[0]).join('') || '?'}</div>
        <h2 className="ctz-profile__name">{user.name}</h2>
        <p className="ctz-profile__role">Citizen / Landowner</p>
        <div className="ctz-kv-list" style={{ marginTop: 20 }}>
          <KV label="Username" value={user.username} />
          <KV label="Login type" value="Demonstration" />
        </div>
        <button className="ctz-btn ctz-btn--outline" style={{ marginTop: 24, width: '100%' }} onClick={onLogout}>
          <Icons.logout /> Sign out
        </button>
        <div className="ctz-profile__footer">
          <p>NiLaM · SIH26016 · Team CLANS</p>
          <p className="ctz-profile__demo">Demonstration environment — no real identity data is processed.</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * App Shell
 * ------------------------------------------------------------------ */

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [tab, setTab] = useState('home');
  const [cases, setCases] = useState(null);
  const [loading, setLoading] = useState(false);
  const [openCase, setOpenCase] = useState(null);
  const [toast, setToast] = useState(null);

  const handleLogin = (u, r) => { setUser(u); setRole(r); };

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.myCases();
      setCases(r.cases);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) loadCases();
  }, [user, loadCases]);

  // Try restoring session
  useEffect(() => {
    if (token && !user) {
      apiFetch('GET', '/api/auth/session').then(r => { setUser(r.user); setRole(r.role); }).catch(() => setToken(null));
    }
  }, []);

  const showToast = (msg, tone = 'ok') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3000);
  };

  const handleConsent = async (caseId, decision, note) => {
    try {
      const r = await api.consent(caseId, decision, note);
      showToast(r.message || 'Response recorded.');
      setOpenCase(null);
      await loadCases();
    } catch (e) { showToast(e.message, 'err'); }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setRole(null);
    setCases(null);
    setOpenCase(null);
    setTab('home');
  };

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  // Case detail is a full-screen overlay
  if (openCase) {
    return (
      <div className="ctz-app">
        <CaseDetailScreen caseData={openCase} onBack={() => setOpenCase(null)} onConsent={handleConsent} />
        {toast && <div className={`ctz-toast ctz-toast--${toast.tone}`}>{toast.msg}</div>}
      </div>
    );
  }

  const TABS = [
    { id: 'home', label: 'Home', icon: Icons.home },
    { id: 'notifications', label: 'Updates', icon: Icons.bell },
    { id: 'profile', label: 'Profile', icon: Icons.user },
  ];

  return (
    <div className="ctz-app">
      <div className="ctz-tricolour" />

      {/* Top bar */}
      <header className="ctz-topbar">
        <div className="ctz-topbar__brand">NiLaM</div>
        <div className="ctz-topbar__badge">Demonstration</div>
      </header>

      {/* Content */}
      <div className="ctz-content">
        {tab === 'home' && <HomeTab cases={cases} loading={loading} onRefresh={loadCases} onOpenCase={setOpenCase} />}
        {tab === 'notifications' && <NotificationsTab user={user} />}
        {tab === 'profile' && <ProfileTab user={user} onLogout={handleLogout} />}
      </div>

      {/* Bottom tab bar */}
      <nav className="ctz-tabbar">
        {TABS.map(t => (
          <button key={t.id} className={`ctz-tabbar__item ${tab === t.id ? 'ctz-tabbar__item--active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className={`ctz-toast ctz-toast--${toast.tone}`}>{toast.msg}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
