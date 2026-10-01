/**
 * NiLaM API service.
 *
 * Express. Route bodies live in `routes.mjs`; shared plumbing (auth, RBAC, audit
 * ledger, case context) lives in `shared.mjs`. This file wires them together and
 * exposes the endpoints that need no domain logic.
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, closeDb } from '../../db/index.mjs';
import { ROLES, STAGES, PURCHASE_STAGES, DOC_TYPES, OFFICER_DESIGNATIONS, LAND_CLASS_FACTORS } from '../../packages/domain/acquisition.mjs';
import { verifyChain, makeToken, verifyPassword } from '../../packages/crypto/index.mjs';
import { adapters, integrationStatus } from './adapters.mjs';
import { appendLedger, requirePermission, nowIso } from './shared.mjs';
import { registerRoutes } from './routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NILAM_PORT || 4180);

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '8mb' }));

/* ------------------------------------------------------------------ *
 * Meta
 * ------------------------------------------------------------------ */

app.get('/api/health', async (_req, res, next) => {
  try {
    const conn = await db();
    const rows = await conn.all('select seq, at, actor_name, action, subject, detail, prev_hash, hash from audit_ledger order by seq');
    const broken = verifyChain(rows);
    res.status(broken === -1 ? 200 : 503).json({
      status: broken === -1 ? 'ok' : 'degraded',
      database: conn.dialect === 'postgres' ? 'PostgreSQL + PostGIS' : 'SQLite via node:sqlite (no Postgres available here)',
      ledger: {
        ok: broken === -1,
        entries: rows.length,
        firstBrokenIndex: broken === -1 ? null : broken,
        head: rows.length ? rows[rows.length - 1].hash : null
      }
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/meta', async (_req, res, next) => {
  try {
    const conn = await db();
    const one = async (sql) => (await conn.get(sql)).n;
    res.json({
      product: 'NiLaM',
      longName: 'National Integrated Land acquisition Module',
      problemStatement: 'SIH26016',
      team: 'CLANS',
      database: conn.dialect === 'postgres'
        ? 'PostgreSQL + PostGIS'
        : 'SQLite via node:sqlite — no Postgres binary or Docker on this machine',
      integrations: integrationStatus(),
      counts: {
        parcels: await one('select count(*) as n from parcels'),
        cases: await one('select count(*) as n from cases'),
        villages: await one('select count(*) as n from villages'),
        documents: await one('select count(*) as n from documents'),
        captures: await one('select count(*) as n from field_captures'),
        discrepancies: await one('select count(*) as n from discrepancies')
      },
      settings: {
        areaTolerance: Number(process.env.NILAM_AREA_TOLERANCE || 0.05),
        accuracyMaxM: Number(process.env.NILAM_ACCURACY_MAX_M || 15),
        minCorners: 3
      },
      serverTime: nowIso()
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/reference', (_req, res) => {
  res.json({
    acquisitionStages: STAGES.map((s) => ({ id: s.id, label: s.label, short: s.short, order: s.order, legalRef: s.legalRef, citizenExplanation: s.citizenExplanation })),
    purchaseStages: PURCHASE_STAGES.map((s) => ({ id: s.id, label: s.label, short: s.short, order: s.order, citizenExplanation: s.citizenExplanation })),
    documentTypes: DOC_TYPES,
    roles: Object.values(ROLES).map((r) => ({ id: r.id, label: r.label, platform: r.platform, permissions: r.permissions })),
    officerDesignations: OFFICER_DESIGNATIONS,
    landClassFactors: LAND_CLASS_FACTORS,
    integrations: integrationStatus()
  });
});

/* ------------------------------------------------------------------ *
 * Authentication
 * ------------------------------------------------------------------ */

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'MISSING_CREDENTIALS', message: 'Username and password are required.' } });
    }
    const conn = await db();
    const user = await conn.get('select * from users where username = ?', [String(username).trim()]);
    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      // A failed attempt is an audit event too. No password material is written.
      await appendLedger(conn, {
        actor: { name: String(username).slice(0, 64), role: 'unknown' },
        action: 'LOGIN_FAILED',
        subject: 'auth',
        detail: { reason: 'invalid credentials' }
      });
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
    }

    const token = makeToken();
    const expires = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    await conn.run('insert into sessions (token, user_id, issued_at, expires_at) values (?, ?, ?, ?)', [
      token, user.id, nowIso(), expires
    ]);
    await appendLedger(conn, {
      actor: { id: user.id, name: user.full_name, role: user.role },
      action: 'LOGIN_SUCCEEDED',
      subject: 'auth',
      detail: { username: user.username, role: user.role }
    });

    res.json({
      token,
      expiresAt: expires,
      user: {
        id: user.id, username: user.username, name: user.full_name, role: user.role,
        designation: user.designation, district: user.district, language: user.language
      },
      role: ROLES[user.role]
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', requirePermission('notification.read.own'), async (req, res, next) => {
  try {
    const conn = await db();
    await conn.run('delete from sessions where token = ?', [(req.headers.authorization || '').slice(7).trim()]);
    await appendLedger(conn, { actor: req.user, action: 'LOGOUT', subject: 'auth' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/session', requirePermission('notification.read.own'), (req, res) => {
  res.json({ user: req.user, role: ROLES[req.user.role] });
});

/* ------------------------------------------------------------------ *
 * Global search — one box, straight to a case
 * ------------------------------------------------------------------ */

app.get('/api/search', requirePermission('case.read'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ query: q, results: [] });
    const like = `%${q.toLowerCase()}%`;
    const conn = await db();
    const rows = await conn.all(
      `select c.id, c.case_no, c.stage, c.track,
              p.survey_no,
              v.name as village_name, v.taluka,
              (select owner_name from parcel_owners o where o.parcel_id = p.id order by o.id limit 1) as owner_name,
              (select name from projects pr where pr.id = c.project_id) as project_name
       from cases c
       join parcels p on p.id = c.parcel_id
       left join villages v on v.id = p.village_id
       where lower(c.case_no) like ?
          or lower(p.survey_no) like ?
          or lower(v.name) like ?
          or lower((select owner_name from parcel_owners o where o.parcel_id = p.id order by o.id limit 1)) like ?
       order by c.id limit 25`,
      [like, like, like, like]
    );
    res.json({
      query: q,
      results: rows.map((r) => ({
        caseId: r.id,
        caseNo: r.case_no,
        surveyNo: r.survey_no,
        village: r.village_name,
        taluka: r.taluka,
        ownerName: r.owner_name,
        project: r.project_name,
        stage: r.stage,
        track: r.track
      }))
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Wire the domain routes and static apps
 * ------------------------------------------------------------------ */

registerRoutes(app);

const WEB = path.resolve(HERE, '../../apps/web/dist');
const CITIZEN = path.resolve(HERE, '../../apps/citizen/dist');
const FIELD = path.resolve(HERE, '../../apps/field/dist');

/* Citizen mobile app */
app.use('/citizen', express.static(CITIZEN));
app.get(['/citizen', '/citizen/*'], (_req, res) => {
  res.sendFile(path.join(CITIZEN, 'index.html'), (err) => {
    if (err) res.status(503).type('text/plain').send('NiLaM Citizen app not built yet. Run: node tools/build-web.mjs');
  });
});

/* Field verifier mobile app */
app.use('/field', express.static(FIELD));
app.get(['/field', '/field/*'], (_req, res) => {
  res.sendFile(path.join(FIELD, 'index.html'), (err) => {
    if (err) res.status(503).type('text/plain').send('NiLaM Field app not built yet. Run: node tools/build-web.mjs');
  });
});

/* Web dashboard */
app.use('/assets', express.static(path.join(WEB, 'assets'), { fallthrough: true }));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(WEB, 'index.html'), (err) => {
    if (err) {
      res.status(503).type('text/plain').send(
        'The NiLaM web application has not been built yet. Run: node tools/build-web.mjs'
      );
    }
  });
});

/** Structured error handler: never leak a stack to a client. */
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL' : 'ERROR');
  if (status >= 500) console.error('[nilam-api]', err);
  res.status(status).json({
    error: { code, message: status >= 500 ? 'An unexpected server error occurred. The action was not applied.' : err.message }
  });
});

export { app };

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = app.listen(PORT, () => {
    const status = integrationStatus();
    console.log('');
    console.log('  NiLaM API');
    console.log(`  http://127.0.0.1:${PORT}`);
    console.log('');
    console.log(`  integrations : ${status.label}`);
    console.log(`  ${status.detail}`);
    console.log('');
  });
  const shutdown = async () => {
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
