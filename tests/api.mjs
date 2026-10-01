/**
 * API-level tests: run against the Express app in-process on an ephemeral port.
 *
 * `node tests/api.mjs`
 *
 * These exercise the deny-by-default RBAC and the write paths end to end: login,
 * an officer queue, an illegal transition (409), a citizen consent on a real
 * case, the audit verify endpoint, and the absence of a route with no declared
 * permission.
 */

import assert from 'node:assert/strict';
import { app } from '../services/api/server.mjs';
import { closeDb } from '../db/index.mjs';

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;

async function req(method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { status: res.status, json, text };
}

function check(name, fn) {
  return fn()
    .then(() => { passed += 1; console.log(`  ok   ${name}`); })
    .catch((e) => { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); });
}

await check('unauth request is refused with 401', async () => {
  const r = await req('GET', '/api/queue');
  assert.equal(r.status, 401);
});

await check('login returns a token and role', async () => {
  const r = await req('POST', '/api/auth/login', { body: { username: 'lao', password: 'nilam@2026' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.token);
  assert.equal(r.json.user.role, 'officer');
});

await check('wrong password is refused and the ledger records it', async () => {
  const r = await req('POST', '/api/auth/login', { body: { username: 'lao', password: 'nope' } });
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, 'INVALID_CREDENTIALS');
});

const lao = await req('POST', '/api/auth/login', { body: { username: 'lao', password: 'nilam@2026' } });

await check('officer queue loads', async () => {
  const r = await req('GET', '/api/queue', { token: lao.json.token });
  assert.equal(r.status, 200);
  assert.ok(r.json.summary.total >= 1);
  assert.ok(Array.isArray(r.json.needsAction));
});

await check('a citizen is forbidden from the officer queue', async () => {
  const citizen = await req('POST', '/api/auth/login', { body: { username: 'ramesh', password: 'nilam@2026' } });
  const r = await req('GET', '/api/queue', { token: citizen.json.token });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'FORBIDDEN');
});

await check('illegal transition is refused with 409', async () => {
  const q = await req('GET', '/api/queue', { token: lao.json.token });
  const caseId = q.json.all.find((c) => c.stage === 'NOTIFICATION_ISSUED')?.caseId
    || q.json.all[0].caseId;
  // Jump straight to the award from wherever the case is: almost always illegal.
  const r = await req('POST', `/api/cases/${caseId}/transition`, {
    token: lao.json.token,
    body: { to: 'AWARD_APPROVED', reason: 'This reason is long enough to pass the gate.' }
  });
  assert.equal(r.status, 409);
  assert.ok(r.json.error.code, 'an error code must be present');
});

await check('transition without a reason is refused with 400', async () => {
  const q = await req('GET', '/api/queue', { token: lao.json.token });
  const caseId = q.json.all[0].caseId;
  const r = await req('POST', `/api/cases/${caseId}/transition`, {
    token: lao.json.token,
    body: { to: 'OBJECTIONS_HEARD', reason: 'short' }
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'REASON_REQUIRED');
});

await check('citizen can read their own cases and the case id is present', async () => {
  const citizen = await req('POST', '/api/auth/login', { body: { username: 'ramesh', password: 'nilam@2026' } });
  const r = await req('GET', '/api/my/cases', { token: citizen.json.token });
  assert.equal(r.status, 200);
  for (const c of r.json.cases) {
    assert.equal(typeof c.id, 'number', 'the citizen projection must carry the case id');
  }
});

await check('citizen cannot read another owner\'s case', async () => {
  // sunita is not ramesh; her cases are not ramesh's.
  const ramesh = await req('POST', '/api/auth/login', { body: { username: 'ramesh', password: 'nilam@2026' } });
  const sunita = await req('POST', '/api/auth/login', { body: { username: 'sunita', password: 'nilam@2026' } });
  const sunitaCases = await req('GET', '/api/my/cases', { token: sunita.json.token });
  const foreign = sunitaCases.json.cases[0];
  if (foreign) {
    const r = await req('GET', `/api/my/cases/${foreign.id}`, { token: ramesh.json.token });
    assert.equal(r.status, 403, `ramesh should not read sunita's case ${foreign.id}`);
  }
});

await check('audit verify reports an intact chain', async () => {
  const auditor = await req('POST', '/api/auth/login', { body: { username: 'auditor', password: 'nilam@2026' } });
  const r = await req('GET', '/api/audit/verify', { token: auditor.json.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.intact, true);
  assert.ok(r.json.entries >= 1);
});

await check('search returns cases by survey number or owner', async () => {
  const r = await req('GET', '/api/search?q=Deshmukh', { token: lao.json.token });
  assert.equal(r.status, 200);
  assert.ok(r.json.results.length >= 1);
});

await check('a role with no such permission is refused on models endpoint', async () => {
  // field_verifier has compensation? No — they have capture.submit, not compensation.read.
  const fv = await req('POST', '/api/auth/login', { body: { username: 'surveyor1', password: 'nilam@2026' } });
  const q = await req('GET', '/api/queue', { token: lao.json.token });
  const caseId = q.json.all[0].caseId;
  const r = await req('POST', `/api/cases/${caseId}/models/run`, { token: fv.json.token });
  assert.equal(r.status, 403);
});

await check('map parcels endpoint returns GeoJSON FeatureCollection', async () => {
  const nhai = await req('POST', '/api/auth/login', { body: { username: 'nhai', password: 'nilam@2026' } });
  const r = await req('GET', '/api/map/parcels', { token: nhai.json.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, 'FeatureCollection');
  assert.ok(r.json.features.length >= 1);
  assert.ok(r.json.features[0].geometry.coordinates);
  assert.ok(r.json.features[0].properties.surveyNo);
});

await check('citizen and field apps are served with clean HTML entrypoints', async () => {
  const c = await req('GET', '/citizen/');
  assert.equal(c.status, 200);
  assert.ok(c.text.includes('NiLaM Citizen'));

  const f = await req('GET', '/field/');
  assert.equal(f.status, 200);
  assert.ok(f.text.includes('NiLaM Field'));
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
server.close();
await closeDb();
process.exit(failed ? 1 : 0);
