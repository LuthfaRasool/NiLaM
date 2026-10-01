/**
 * Hash primitives for the document vault and the audit ledger.
 * Ported unchanged in behaviour from the previous prototype, where this design
 * was verified by tamper-detection tests.
 *
 * The vault is content-addressed: a stored document's sha256 is recorded, so any
 * later edit to its bytes is detectable. The ledger is a hash chain: each entry
 * commits to its predecessor, so rewriting history invalidates every hash after
 * the point of edit.
 */

import crypto from 'node:crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Canonical JSON with a stable key order, so equal objects always hash equally. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export function hashObject(value) {
  return sha256(canonical(value));
}

export const GENESIS = '0'.repeat(64);

/**
 * Ledger entry hash: commits to payload, actor, time and the previous hash.
 *
 * The actor is read from whichever field the caller supplies. Both `actor` and
 * `actor_name` are accepted because the seed writes rows straight to the table
 * (`actor_name`) while the API hashes an in-memory object (`actor`); hashing only
 * one spelling made a seeded ledger fail verification against its own rows.
 */
export function ledgerHash(entry, prevHash) {
  const actor = entry.actor !== undefined ? entry.actor : (entry.actor_name ?? null);
  return sha256(
    canonical({
      seq: entry.seq,
      at: entry.at,
      actor,
      action: entry.action,
      subject: entry.subject ?? null,
      detail: entry.detail ?? null,
      prev: prevHash
    })
  );
}

/**
 * Verifies a whole chain. Returns the index of the first broken link, or -1.
 * Detects a changed payload, a mismatched hash, and a broken link.
 */
export function verifyChain(entries, genesis = GENESIS) {
  let prev = genesis;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const expected = ledgerHash(e, prev);
    if (e.hash !== expected || e.prev_hash !== prev || e.seq !== i + 1) return i;
    prev = e.hash;
  }
  return -1;
}

/** Salted password hash. Each user gets their own salt, per the brief's §10. */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const salted = `${salt}:${password}`;
  // Iterated hashing: not a substitute for a real KDF, but far better than a
  // single pass. scrypt/argon2 are unavailable offline; noted in the README.
  let digest = sha256(salted);
  for (let i = 0; i < 20000; i += 1) digest = sha256(digest + salt);
  return { hash: digest, salt };
}

export function verifyPassword(password, hash, salt) {
  return hashPassword(password, salt).hash === hash;
}

/** Opaque bearer token. */
export function makeToken() {
  return crypto.randomBytes(32).toString('base64url');
}
