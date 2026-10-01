/**
 * NiLaM Field Verifier Mobile App
 *
 * A mobile-first app for field surveyors to:
 * - View assigned parcels for survey
 * - Capture corner photos with the device camera
 * - Geotag each corner with GPS coordinates
 * - Review and submit the survey
 * - Queue surveys offline and sync when connected
 *
 * Uses Web APIs:
 * - navigator.mediaDevices.getUserMedia() for camera
 * - navigator.geolocation.getCurrentPosition() for GPS
 * - localStorage for offline queue
 *
 * Served at /field/ as a separate entry point.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

/* ------------------------------------------------------------------ *
 * API client
 * ------------------------------------------------------------------ */

const TOKEN_KEY = 'nilam.field.token';
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
  assignments: () => apiFetch('GET', '/api/field/assignments'),
  submitCapture: (caseId, payload) => apiFetch('POST', `/api/cases/${caseId}/capture`, payload),
  sync: (clientId, items) => apiFetch('POST', '/api/field/sync', { clientId, items }),
  session: () => apiFetch('GET', '/api/auth/session'),
};

/* ------------------------------------------------------------------ *
 * Offline Queue
 * ------------------------------------------------------------------ */

const QUEUE_KEY = 'nilam.field.queue';
const offlineQueue = {
  read() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } },
  write(items) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items)); } catch {} return items; },
  add(item) { const items = offlineQueue.read(); items.push({ ...item, clientId: `q-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, queuedAt: new Date().toISOString() }); return offlineQueue.write(items); },
  remove(ids) { const drop = new Set(ids); return offlineQueue.write(offlineQueue.read().filter(i => !drop.has(i.clientId))); },
  count() { return offlineQueue.read().length; }
};

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

const Icons = {
  camera: () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  map: () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  gps: () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="8"/></svg>,
  check: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  sync: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
  back: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>,
  alert: () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  logout: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  list: () => <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  crosshair: () => <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.3"/><line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="2" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="22" y2="12"/></svg>,
};

/* ------------------------------------------------------------------ *
 * Login
 * ------------------------------------------------------------------ */

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const DEMO = [
    { id: 'surveyor1', name: 'Amit Patil', hint: 'Field Surveyor — multiple assignments' },
    { id: 'surveyor2', name: 'Pradeep Ingle', hint: 'Field Surveyor' },
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
    <div className="fld-login">
      <div className="fld-tricolour" />
      <div className="fld-login__body">
        <div className="fld-login__brand">
          <h1>NiLaM Field</h1>
          <p>Land Survey & Verification</p>
        </div>
        <div className="fld-card">
          <h2>Sign in</h2>
          {error && <div className="fld-alert fld-alert--err">{error}</div>}
          <form onSubmit={e => { e.preventDefault(); submit(); }}>
            <label className="fld-field"><span>Username</span>
              <input className="fld-input" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" />
            </label>
            <label className="fld-field"><span>Password</span>
              <input className="fld-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" />
            </label>
            <button className="fld-btn fld-btn--primary" type="submit" disabled={busy || !username || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
        <div className="fld-demo-section">
          <p>Demo accounts · password <code>nilam@2026</code></p>
          {DEMO.map(d => (
            <button key={d.id} className="fld-demo-btn" onClick={() => submit(d.id, 'nilam@2026')}>
              <strong>{d.name}</strong><span>{d.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Assignments List
 * ------------------------------------------------------------------ */

function AssignmentList({ data, onSelect, pendingSync, onSync, syncing }) {
  if (!data) return <div className="fld-loading">Loading assignments…</div>;

  return (
    <div className="fld-assignments">
      <div className="fld-section-header">
        <h2>Survey Assignments</h2>
        <span className="fld-badge">{data.assignments.length}</span>
      </div>

      {pendingSync > 0 && (
        <button className="fld-sync-banner" onClick={onSync} disabled={syncing}>
          <Icons.sync />
          <span>{syncing ? 'Syncing…' : `${pendingSync} survey${pendingSync > 1 ? 's' : ''} queued offline — tap to sync`}</span>
        </button>
      )}

      <div className="fld-info-bar">
        <Icons.gps /> Min. {data.minCorners} corners · ±{data.accuracyMaxM}m accuracy
      </div>

      {data.assignments.length === 0 ? (
        <div className="fld-empty">
          <Icons.map />
          <h3>No assignments</h3>
          <p>New survey assignments will appear here when assigned by the officer.</p>
        </div>
      ) : (
        <div className="fld-list">
          {data.assignments.map(a => (
            <button key={a.caseId} className="fld-assign-card" onClick={() => onSelect(a)}>
              <div className="fld-assign-card__top">
                <span className="fld-assign-card__case">{a.caseNo}</span>
                {a.captureCount > 0 && <span className="fld-badge fld-badge--done">{a.captureCount} done</span>}
              </div>
              <div className="fld-assign-card__details">
                <span>Sy. No. {a.surveyNo}</span>
                <span>{a.village}, {a.taluka}</span>
                <span>{a.recordAreaHectares.toFixed(4)} ha · {a.landClass}</span>
                <span>Owner: {a.ownerName}</span>
              </div>
              <div className="fld-assign-card__action">
                <Icons.camera /> Start Survey
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Camera + GPS Capture Screen
 * ------------------------------------------------------------------ */

function CaptureScreen({ assignment, onComplete, onCancel, minCorners }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [corners, setCorners] = useState([]);
  const [gps, setGps] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [phase, setPhase] = useState('camera'); // 'camera' | 'review' | 'submitting'
  const [note, setNote] = useState('');
  const totalExpected = Math.max(4, minCorners || 3);

  // Start camera
  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
      } catch (err) {
        setCameraError(err.message || 'Camera access denied. Please allow camera permissions.');
      }
    }
    if (phase === 'camera') startCamera();
    return () => {
      mounted = false;
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };
  }, [phase]);

  // Get GPS location continuously
  useEffect(() => {
    if (phase !== 'camera') return;
    let watchId = null;
    if (navigator.geolocation) {
      setGpsLoading(true);
      watchId = navigator.geolocation.watchPosition(
        pos => {
          setGps({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading,
            timestamp: pos.timestamp,
            mock: false // browser can't detect mock location reliably; server checks
          });
          setGpsLoading(false);
          setGpsError(null);
        },
        err => {
          setGpsError(err.message || 'GPS unavailable');
          setGpsLoading(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    } else {
      setGpsError('Geolocation not supported by this browser.');
    }
    return () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); };
  }, [phase]);

  const captureCorner = () => {
    if (!videoRef.current || !gps) return;

    // Capture photo from video
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.7);

    const corner = {
      index: corners.length + 1,
      lat: gps.lat,
      lon: gps.lon,
      accuracyM: gps.accuracy,
      headingDeg: gps.heading,
      mockLocation: gps.mock,
      capturedAt: new Date().toISOString(),
      photo: photoDataUrl,
      photoHash: simpleHash(photoDataUrl),
    };

    const updated = [...corners, corner];
    setCorners(updated);

    // Flash effect
    setCapturedPhoto(photoDataUrl);
    setTimeout(() => setCapturedPhoto(null), 500);
  };

  const removeLastCorner = () => {
    setCorners(corners.slice(0, -1));
  };

  const goToReview = () => {
    // Stop camera
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setPhase('review');
  };

  const submitSurvey = async () => {
    setPhase('submitting');
    const payload = {
      caseId: assignment.caseId,
      corners: corners.map(c => ({
        lat: c.lat, lon: c.lon,
        accuracyM: c.accuracyM,
        headingDeg: c.headingDeg,
        mockLocation: c.mockLocation,
        capturedAt: c.capturedAt,
        photoHash: c.photoHash,
      })),
      note,
      clientAreaHectares: null,
      device: navigator.userAgent.slice(0, 100),
    };

    try {
      await api.submitCapture(assignment.caseId, payload);
      onComplete({ success: true, message: 'Survey submitted successfully.' });
    } catch (err) {
      // Queue offline
      offlineQueue.add(payload);
      onComplete({ success: false, message: `Queued offline: ${err.message}`, queued: true });
    }
  };

  if (phase === 'review' || phase === 'submitting') {
    return (
      <div className="fld-capture">
        <div className="fld-capture__header">
          <button className="fld-btn fld-btn--icon" onClick={() => setPhase('camera')}><Icons.back /></button>
          <h2>Review Survey</h2>
        </div>

        <div className="fld-review">
          <div className="fld-review__info">
            <strong>{assignment.caseNo}</strong>
            <span>Sy. No. {assignment.surveyNo} · {assignment.village}</span>
          </div>

          <h3>{corners.length} Corners Captured</h3>
          <div className="fld-corner-grid">
            {corners.map((c, i) => (
              <div key={i} className="fld-corner-thumb">
                <img src={c.photo} alt={`Corner ${i + 1}`} />
                <div className="fld-corner-thumb__label">
                  Corner {i + 1}
                  <span className="fld-corner-thumb__coords">
                    {c.lat.toFixed(6)}, {c.lon.toFixed(6)}
                  </span>
                  <span className="fld-corner-thumb__acc">±{c.accuracyM?.toFixed(1)}m</span>
                </div>
              </div>
            ))}
          </div>

          <label className="fld-field">
            <span>Notes (optional)</span>
            <textarea className="fld-input fld-input--textarea" value={note} onChange={e => setNote(e.target.value)} placeholder="Any observations about the land…" rows={3} />
          </label>

          <button className="fld-btn fld-btn--primary fld-btn--lg" onClick={submitSurvey} disabled={phase === 'submitting'}>
            {phase === 'submitting' ? 'Submitting…' : '✓ Submit Survey'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fld-capture">
      {/* Header */}
      <div className="fld-capture__header">
        <button className="fld-btn fld-btn--icon" onClick={onCancel}><Icons.back /></button>
        <h2>Corner {corners.length + 1} of {totalExpected}</h2>
        <span className="fld-badge">{corners.length} done</span>
      </div>

      {/* Assignment info */}
      <div className="fld-capture__parcel-info">
        <span>{assignment.caseNo}</span>
        <span>Sy. No. {assignment.surveyNo} · {assignment.village}</span>
      </div>

      {/* Camera viewfinder */}
      <div className="fld-viewfinder">
        {cameraError ? (
          <div className="fld-viewfinder__error">
            <Icons.camera />
            <p>{cameraError}</p>
            <p className="fld-small">Grant camera permission in your browser settings and reload.</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="fld-viewfinder__video" playsInline muted autoPlay />
            <div className="fld-viewfinder__overlay">
              <div className="fld-viewfinder__crosshair"><Icons.crosshair /></div>
              <div className="fld-viewfinder__corner-label">
                Point camera at Corner {corners.length + 1}
              </div>
            </div>
            {capturedPhoto && <div className="fld-viewfinder__flash" />}
          </>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {/* GPS info bar */}
      <div className={`fld-gps-bar ${gps ? (gps.accuracy <= 15 ? 'fld-gps-bar--good' : 'fld-gps-bar--fair') : 'fld-gps-bar--wait'}`}>
        <Icons.gps />
        {gpsLoading && !gps ? (
          <span>Acquiring GPS signal…</span>
        ) : gpsError ? (
          <span className="fld-gps-bar__err">{gpsError}</span>
        ) : gps ? (
          <span>
            {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)} · ±{gps.accuracy.toFixed(1)}m
            {gps.accuracy > 15 && <span className="fld-gps-bar__warn"> (poor accuracy)</span>}
          </span>
        ) : (
          <span>Waiting for GPS…</span>
        )}
      </div>

      {/* Captured corners strip */}
      {corners.length > 0 && (
        <div className="fld-corner-strip">
          {corners.map((c, i) => (
            <div key={i} className="fld-corner-mini">
              <img src={c.photo} alt={`Corner ${i + 1}`} />
              <span>C{i + 1}</span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="fld-capture__actions">
        {corners.length > 0 && (
          <button className="fld-btn fld-btn--ghost" onClick={removeLastCorner}>
            Undo last
          </button>
        )}
        <button
          className="fld-btn fld-btn--capture"
          onClick={captureCorner}
          disabled={!cameraReady || !gps}
        >
          <Icons.camera />
          Capture Corner {corners.length + 1}
        </button>
        {corners.length >= (minCorners || 3) && (
          <button className="fld-btn fld-btn--primary" onClick={goToReview}>
            Review & Submit →
          </button>
        )}
      </div>
    </div>
  );
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 1000); i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ *
 * App Shell
 * ------------------------------------------------------------------ */

function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [activeAssignment, setActiveAssignment] = useState(null);
  const [toast, setToast] = useState(null);
  const [pendingSync, setPendingSync] = useState(offlineQueue.count());
  const [syncing, setSyncing] = useState(false);

  const handleLogin = (u, r) => setUser(u);

  const loadAssignments = useCallback(async () => {
    try {
      const r = await api.assignments();
      setData(r);
    } catch {}
  }, []);

  useEffect(() => { if (user) loadAssignments(); }, [user, loadAssignments]);

  useEffect(() => {
    if (token && !user) {
      api.session().then(r => setUser(r.user)).catch(() => setToken(null));
    }
  }, []);

  const showToast = (msg, tone = 'ok') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCaptureComplete = async (result) => {
    setActiveAssignment(null);
    setPendingSync(offlineQueue.count());
    showToast(result.message, result.success ? 'ok' : 'warn');
    await loadAssignments();
  };

  const handleSync = async () => {
    setSyncing(true);
    const items = offlineQueue.read();
    try {
      const r = await api.sync(`device-${Date.now()}`, items);
      const accepted = r.results?.filter(r => r.accepted).map(r => r.clientId) || [];
      offlineQueue.remove(accepted);
      setPendingSync(offlineQueue.count());
      showToast(`Synced ${accepted.length} of ${items.length} surveys.`);
      await loadAssignments();
    } catch (e) {
      showToast(`Sync failed: ${e.message}`, 'err');
    }
    setSyncing(false);
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setData(null);
    setActiveAssignment(null);
  };

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  if (activeAssignment) {
    return (
      <div className="fld-app">
        <CaptureScreen
          assignment={activeAssignment}
          onComplete={handleCaptureComplete}
          onCancel={() => setActiveAssignment(null)}
          minCorners={data?.minCorners || 3}
        />
        {toast && <div className={`fld-toast fld-toast--${toast.tone}`}>{toast.msg}</div>}
      </div>
    );
  }

  return (
    <div className="fld-app">
      <div className="fld-tricolour" />
      <header className="fld-topbar">
        <div>
          <div className="fld-topbar__brand">NiLaM Field</div>
          <div className="fld-topbar__user">{user.name}</div>
        </div>
        <button className="fld-btn fld-btn--icon" onClick={handleLogout}><Icons.logout /></button>
      </header>

      <div className="fld-content">
        <AssignmentList
          data={data}
          onSelect={setActiveAssignment}
          pendingSync={pendingSync}
          onSync={handleSync}
          syncing={syncing}
        />
      </div>

      {toast && <div className={`fld-toast fld-toast--${toast.tone}`}>{toast.msg}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
