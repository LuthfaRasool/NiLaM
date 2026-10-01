/**
 * NiLaM component library.
 *
 * Built once and reused across the dashboard and the mobile app. Two rules are
 * enforced by the components themselves rather than left to reviewers:
 *
 *   - `StatusChip` always renders an icon and a word, never colour alone.
 *   - `Field` always renders an explicit error message rather than relying on a
 *     red border, so the reason is available to a screen reader.
 */

import React, { useState, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ *
 * Icons
 *
 * Inline SVG on a 16px grid. No icon font, no emoji as interface.
 * ------------------------------------------------------------------ */

const S = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const Icon = {
  check: (p) => <svg {...S} {...p}><path d="M3 8.5l3.2 3.2L13 5" /></svg>,
  alert: (p) => <svg {...S} {...p}><path d="M8 2.6L14.4 13.4H1.6L8 2.6z" /><path d="M8 6.6v3.1M8 11.6h.01" /></svg>,
  info: (p) => <svg {...S} {...p}><circle cx="8" cy="8" r="6.2" /><path d="M8 7.4v4M8 5.2h.01" /></svg>,
  x: (p) => <svg {...S} {...p}><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  clock: (p) => <svg {...S} {...p}><circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8l2.4 1.6" /></svg>,
  minus: (p) => <svg {...S} {...p}><path d="M3.5 8h9" /></svg>,
  doc: (p) => <svg {...S} {...p}><path d="M9.2 1.8H4.4a1 1 0 00-1 1v10.4a1 1 0 001 1h7.2a1 1 0 001-1V5.4L9.2 1.8z" /><path d="M9.2 1.8v3.6h3.4" /></svg>,
  map: (p) => <svg {...S} {...p}><path d="M1.8 4.2l4.2-1.6 4 1.6 4.2-1.6v9.2l-4.2 1.6-4-1.6-4.2 1.6V4.2z" /><path d="M6 2.6v9.2M10 4.2v9.2" /></svg>,
  pin: (p) => <svg {...S} {...p}><path d="M8 14.4s4.6-4.1 4.6-7.4A4.6 4.6 0 003.4 7c0 3.3 4.6 7.4 4.6 7.4z" /><circle cx="8" cy="7" r="1.7" /></svg>,
  shield: (p) => <svg {...S} {...p}><path d="M8 1.8l5 1.8v4.2c0 3.2-2.1 5.6-5 6.4-2.9-.8-5-3.2-5-6.4V3.6l5-1.8z" /><path d="M5.8 8l1.6 1.6 2.9-3.1" /></svg>,
  search: (p) => <svg {...S} {...p}><circle cx="7.2" cy="7.2" r="4.6" /><path d="M10.6 10.6l3 3" /></svg>,
  user: (p) => <svg {...S} {...p}><circle cx="8" cy="5.4" r="2.7" /><path d="M2.8 13.6c0-2.7 2.3-4.4 5.2-4.4s5.2 1.7 5.2 4.4" /></svg>,
  home: (p) => <svg {...S} {...p}><path d="M2.4 6.8L8 2.4l5.6 4.4v6.4a.8.8 0 01-.8.8H3.2a.8.8 0 01-.8-.8V6.8z" /></svg>,
  cash: (p) => <svg {...S} {...p}><rect x="1.6" y="3.6" width="12.8" height="8.8" rx="1.2" /><circle cx="8" cy="8" r="2.2" /></svg>,
  layers: (p) => <svg {...S} {...p}><path d="M8 1.8l6 3-6 3-6-3 6-3z" /><path d="M2 8.4l6 3 6-3M2 11.2l6 3 6-3" /></svg>,
  chart: (p) => <svg {...S} {...p}><path d="M2 13.4h12" /><path d="M4.4 13.4V8.2M8 13.4V4.2M11.6 13.4v-3.4" /></svg>,
  sync: (p) => <svg {...S} {...p}><path d="M13.4 8a5.4 5.4 0 01-9.4 3.6" /><path d="M2.6 8a5.4 5.4 0 019.4-3.6" /><path d="M12 2v2.6h-2.6M4 14v-2.6h2.6" /></svg>,
  wifi_off: (p) => <svg {...S} {...p}><path d="M2 2l12 12" /><path d="M5.4 10.2a3.7 3.7 0 015.2 0M2.8 7.4a7.4 7.4 0 012.3 1.3M13.2 7.4a7.4 7.4 0 00-2.3 1.3M8 13.2h.01" /></svg>,
  chevron: (p) => <svg {...S} {...p}><path d="M6 3.6L10.4 8 6 12.4" /></svg>,
  back: (p) => <svg {...S} {...p}><path d="M10 3.6L5.6 8 10 12.4" /></svg>,
  camera: (p) => <svg {...S} {...p}><path d="M2 5.4h2.6l1-1.6h4.8l1 1.6H14v7.2H2V5.4z" /><circle cx="8" cy="8.9" r="2.3" /></svg>,
  lock: (p) => <svg {...S} {...p}><rect x="3.2" y="7" width="9.6" height="6.4" rx="1.2" /><path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7" /></svg>,
  logout: (p) => <svg {...S} {...p}><path d="M6.4 2.4H3.2a.8.8 0 00-.8.8v9.6a.8.8 0 00.8.8h3.2" /><path d="M10.4 11.2L13.6 8l-3.2-3.2M13.6 8H6.4" /></svg>,
  scale: (p) => <svg {...S} {...p}><path d="M8 2.2v11.6M4.4 13.8h7.2" /><path d="M2.4 5.4h11.2M2.4 5.4L1 9.2h2.8L2.4 5.4zM13.6 5.4L12.2 9.2H15l-1.4-3.8z" /></svg>
};

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

const TONE_ICON = {
  ok: Icon.check,
  warn: Icon.alert,
  err: Icon.alert,
  info: Icon.info,
  idle: Icon.minus
};

/** Colour + icon + word. Never colour alone. */
export function StatusChip({ tone = 'idle', children, title }) {
  const Ico = TONE_ICON[tone] || Icon.minus;
  return (
    <span className={`nilam-chip nilam-chip--${tone}`} title={title}>
      <span className="nilam-chip__icon" aria-hidden="true"><Ico /></span>
      <span>{children}</span>
    </span>
  );
}

const SLA_TONE = { on_track: 'ok', at_risk: 'warn', breached: 'err', closed: 'idle', blocked: 'err' };
const SLA_WORD = { on_track: 'On time', at_risk: 'Due soon', breached: 'Overdue', closed: 'Closed', blocked: 'On hold' };

export function SlaChip({ sla }) {
  if (!sla) return null;
  return (
    <StatusChip tone={SLA_TONE[sla.verdict] || 'idle'} title={`${sla.elapsedDays} of ${sla.slaDays} days used`}>
      {SLA_WORD[sla.verdict] || sla.verdict}
    </StatusChip>
  );
}

const RISK_TONE = { low: 'ok', medium: 'warn', high: 'err' };
const RISK_WORD = { low: 'Low risk', medium: 'Watch', high: 'High risk' };

export function RiskChip({ tier }) {
  if (!tier) return null;
  return <StatusChip tone={RISK_TONE[tier] || 'idle'}>{RISK_WORD[tier] || tier}</StatusChip>;
}

const SEV_TONE = { critical: 'err', warning: 'warn', info: 'info' };

export function SeverityChip({ severity }) {
  return (
    <StatusChip tone={SEV_TONE[severity] || 'idle'}>
      {severity === 'critical' ? 'Must fix' : severity === 'warning' ? 'Note' : 'Info'}
    </StatusChip>
  );
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export function Button({ variant = 'secondary', size, block, loading, children, ...rest }) {
  const cls = ['nilam-btn', `nilam-btn--${variant}`];
  if (size === 'lg') cls.push('nilam-btn--lg');
  if (block) cls.push('nilam-btn--block');
  return (
    <button className={cls.join(' ')} disabled={rest.disabled || loading} {...rest}>
      {loading ? 'Working…' : children}
    </button>
  );
}

export function Card({ title, actions, children, footer, className = '' }) {
  return (
    <section className={`nilam-card ${className}`}>
      {(title || actions) && (
        <header className="nilam-card__head">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {actions && <div className="nilam-row">{actions}</div>}
        </header>
      )}
      <div className="nilam-card__body">{children}</div>
      {footer && <footer className="nilam-card__foot">{footer}</footer>}
    </section>
  );
}

/**
 * A form field with an explicit error message.
 *
 * The error is rendered as text rather than only a red border, so the reason is
 * readable by assistive technology and by anyone who cannot distinguish the
 * colour.
 */
export function Field({ label, hint, error, required, children, htmlFor }) {
  return (
    <div className="nilam-field">
      {label && (
        <label className="nilam-field__label" htmlFor={htmlFor}>
          {label}{required && <span className="nilam-field__req" aria-hidden="true">*</span>}
          {required && <span className="nilam-skip">required</span>}
        </label>
      )}
      {children}
      {hint && !error && <div className="nilam-field__hint">{hint}</div>}
      {error && (
        <div className="nilam-field__error" role="alert">
          <span aria-hidden="true"><Icon.alert /></span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export function Input({ invalid, ...rest }) {
  return <input className={`nilam-input${invalid ? ' nilam-input--invalid' : ''}`} {...rest} />;
}

export function Textarea({ invalid, ...rest }) {
  return <textarea className={`nilam-textarea${invalid ? ' nilam-textarea--invalid' : ''}`} {...rest} />;
}

export function Select({ children, ...rest }) {
  return <select className="nilam-select" {...rest}>{children}</select>;
}

export function Metric({ label, value, foot, tone }) {
  return (
    <div className="nilam-card nilam-metric">
      <div className="nilam-metric__label">{label}</div>
      <div className={`nilam-metric__value${tone ? ` nilam-metric__value--${tone}` : ''}`}>{value}</div>
      {foot && <div className="nilam-metric__foot">{foot}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }) {
  const Ico = tone === 'err' || tone === 'warn' ? Icon.alert : tone === 'ok' ? Icon.check : Icon.info;
  return (
    <div className={`nilam-alert nilam-alert--${tone}`} role={tone === 'err' ? 'alert' : undefined}>
      <span className="nilam-alert__icon" aria-hidden="true"><Ico /></span>
      <div className="nilam-alert__body">
        {title && <div className="nilam-alert__title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

/**
 * The single badge that tells a user they are looking at demonstration data.
 * Present in the header of every surface, and on every adapter-derived panel.
 */
export function DemoBadge({ detail }) {
  return (
    <span
      className="nilam-chip nilam-chip--warn"
      title={detail || 'Demonstration data and integrations. No government service is contacted.'}
    >
      <span className="nilam-chip__icon" aria-hidden="true"><Icon.info /></span>
      <span>Demonstration</span>
    </span>
  );
}

export function Disclosure({ summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <div className="nilam-disclosure">
      <button className="nilam-disclosure__btn" onClick={toggle} aria-expanded={open}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} aria-hidden="true">
          <Icon.chevron />
        </span>
        <span>{summary}</span>
      </button>
      {open && <div className="nilam-disclosure__body">{children}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100;
  return (
    <div className="nilam-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`nilam-bar__fill${tone ? ` nilam-bar__fill--${tone}` : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="nilam-empty">
      <div className="nilam-empty__title">{title}</div>
      {children}
    </div>
  );
}

export function Skeleton({ height = 14, width = '100%', style }) {
  return <div className="nilam-skel" style={{ height, width, ...style }} />;
}

export function KeyValue({ rows }) {
  return (
    <div className="nilam-kv">
      {rows.filter(Boolean).map(([k, v], i) => (
        <React.Fragment key={`${k}-${i}`}>
          <div className="nilam-kv__k">{k}</div>
          <div className="nilam-kv__v">{v}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function PageHeader({ crumb, title, subtitle, actions }) {
  return (
    <div className="nilam-page__head">
      <div className="nilam-page__head-main">
        {crumb && <div className="nilam-page__crumb">{crumb}</div>}
        <h1>{title}</h1>
        {subtitle && <div style={{ color: 'var(--ink-500)', fontSize: 'var(--size-sm)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions && <div className="nilam-page__actions">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Timeline — the one status tracker used across the product
 * ------------------------------------------------------------------ */

export function Timeline({ steps }) {
  return (
    <ol className="nilam-timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((s) => {
        const state = s.done ? 'done' : s.current ? 'current' : 'pending';
        return (
          <li className="nilam-tl-item" key={s.id}>
            <div className="nilam-tl-rail">
              <span className={`nilam-tl-dot nilam-tl-dot--${state}`} aria-hidden="true">
                {s.done ? '✓' : s.current ? '•' : ''}
              </span>
              <span className="nilam-tl-line" />
            </div>
            <div className="nilam-tl-body">
              <div className={`nilam-tl-title${s.pending ? ' nilam-tl-title--muted' : ''}`}>
                {s.label}
                {s.current && <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--blue-600)' }}>— you are here</span>}
              </div>
              {s.explanation && (s.current || s.done) && <div className="nilam-tl-desc">{s.explanation}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * Checklist
 * ------------------------------------------------------------------ */

export function Checklist({ clearance }) {
  if (!clearance) return null;
  return (
    <div>
      <Alert tone={clearance.cleared ? (clearance.warnings ? 'warn' : 'ok') : 'err'} title={clearance.headline}>
        {clearance.clearCount} of {clearance.total} checks passed.
      </Alert>
      <div style={{ marginTop: 'var(--s4)' }}>
        {clearance.items.map((item) => {
          const mark = item.clear ? 'clear' : item.severity === 'critical' ? 'block' : 'warn';
          return (
            <div className="nilam-check" key={item.id}>
              <span className={`nilam-check__mark nilam-check__mark--${mark}`} aria-hidden="true">
                {item.clear ? '✓' : '!'}
              </span>
              <div className="nilam-check__body">
                <div className="nilam-check__label">
                  {item.label}
                  <span style={{ marginLeft: 8, fontWeight: 400 }}>
                    {item.clear ? '— clear' : item.severity === 'critical' ? '— blocking' : '— to note'}
                  </span>
                </div>
                <div className="nilam-check__q">{item.question}</div>
                {!item.clear && item.action && <div className="nilam-check__action">{item.action}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Parcel map — vector, from stored geometry
 * ------------------------------------------------------------------ */

const CLASS_FILL = {
  agricultural: '#cfe3c8',
  homestead: '#f2d9a8',
  commercial: '#f0bfae',
  barren: '#ded6c4',
  forest: '#a9c9a4',
  waterbody: '#bcd8e8'
};

/**
 * Draws a parcel, the notified boundary and the captured corner ring.
 *
 * A hand-written canvas renderer rather than a mapping library: MapLibre and
 * Leaflet are not obtainable offline, and there is no tile source anyway. The
 * geometry is real — it is the stored PostGIS-shaped GeoJSON — so this shows the
 * actual parcel rather than a decorative sketch.
 */
export function ParcelMap({ parcel, capture, height = 300 }) {
  const ref = React.useRef(null);
  const [hud, setHud] = useState('');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !parcel?.geometry) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Ground
      ctx.fillStyle = '#eef2ee';
      ctx.fillRect(0, 0, w, h);

      const rings = parcel.geometry.type === 'MultiPolygon'
        ? parcel.geometry.coordinates.flat()
        : parcel.geometry.coordinates;

      const pts = rings.flat().filter((c) => Array.isArray(c) && Number.isFinite(c[0]));

      // The captured ring, if any, participates in the extent so the officer can
      // see a mis-survey immediately rather than having it clipped away.
      const captureRings = capture?.polygon
        ? (capture.polygon.type === 'MultiPolygon' ? capture.polygon.coordinates.flat() : capture.polygon.coordinates)
        : [];
      const capturePts = captureRings.flat().filter((c) => Array.isArray(c) && Number.isFinite(c[0]));
      const all = pts.concat(capturePts);
      if (!all.length) return;

      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      const pad = 28;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const spanX = Math.max(1e-9, maxX - minX);
      const spanY = Math.max(1e-9, maxY - minY);
      const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
      const offX = (w - spanX * scale) / 2;
      const offY = (h - spanY * scale) / 2;
      const project = ([lon, lat]) => [offX + (lon - minX) * scale, h - (offY + (lat - minY) * scale)];

      const path = (ring) => {
        ctx.beginPath();
        ring.forEach((c, i) => {
          const [x, y] = project(c);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      };

      // Parcel fill
      rings.forEach((ring) => {
        if (!Array.isArray(ring) || ring.length < 3) return;
        path(ring);
        ctx.fillStyle = CLASS_FILL[parcel.landClass] || '#dfe7dd';
        ctx.fill();
        ctx.strokeStyle = '#4b5b52';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Captured corner ring, drawn dashed so it reads as a measurement
      captureRings.forEach((ring) => {
        if (!Array.isArray(ring) || ring.length < 3) return;
        path(ring);
        const ok = capture?.status === 'verified';
        ctx.fillStyle = ok ? 'rgba(22,101,52,0.14)' : 'rgba(164,38,44,0.16)';
        ctx.fill();
        ctx.strokeStyle = ok ? '#166534' : '#a4262c';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Captured corners
      if (capture?.corners?.length) {
        capture.corners.forEach((c) => {
          const [x, y] = project([c.lon, c.lat]);
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = c.mockLocation ? '#a4262c' : '#10559f';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.fillStyle = '#10559f';
          ctx.font = '600 11px "Noto Sans", system-ui, sans-serif';
          ctx.fillText(String(c.index), x + 8, y - 7);
        });
      }

      setHud(`${Math.round(w)}×${Math.round(h)} px · ${rings.length} ring(s) · scale 1:${Math.round(111320 * Math.cos((minY * Math.PI) / 180) / scale).toLocaleString('en-IN')}`);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [parcel, capture]);

  return (
    <div className="nilam-map" style={{ minHeight: height }}>
      <canvas ref={ref} aria-label={`Map of Survey No. ${parcel?.surveyNo || ''}`} role="img" />
      <div className="nilam-map__legend">
        <div className="nilam-map__key">
          <span className="nilam-map__swatch" style={{ background: CLASS_FILL[parcel?.landClass] || '#dfe7dd' }} />
          <span>Notified parcel ({parcel?.landClass})</span>
        </div>
        {capture && (
          <div className="nilam-map__key">
            <span className="nilam-map__swatch" style={{ background: capture.status === 'verified' ? 'rgba(22,101,52,0.3)' : 'rgba(164,38,44,0.3)', borderStyle: 'dashed' }} />
            <span>Measured boundary ({capture.cornerCount} corners)</span>
          </div>
        )}
      </div>
      <div className="nilam-map__hint">{hud}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'info', ms = 4200) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  const view = (
    <div className="nilam-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`nilam-toast${t.tone === 'error' ? ' nilam-toast--err' : t.tone === 'ok' ? ' nilam-toast--ok' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
  return { push, view };
}
