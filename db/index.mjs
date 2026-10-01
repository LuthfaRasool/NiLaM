/**
 * Database access.
 *
 * One interface, two backends:
 *
 *   - `postgres` — the deployment target. Uses `pg` with real PostGIS, so
 *     spatial predicates execute in SQL and are spatially indexed.
 *   - `sqlite`   — the runnable substitute when there is no Postgres binary on
 *     the machine. Uses Node's built-in `node:sqlite`, so it is a genuine SQL
 *     database with constraints and transactions, not an in-memory mock.
 *
 * `NILAM_DB=postgres|sqlite` selects the backend. Both expose `query`, `get`,
 * `all`, `run`, `transaction` and `raw`. Application code never sees a dialect
 * switch except in `db/spatial.mjs`, which is where the decision belongs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const DIALECT = process.env.NILAM_DB === 'postgres' ? 'postgres' : 'sqlite';

function sqliteFile() {
  return process.env.NILAM_SQLITE || path.join(ROOT, 'data', 'nilam.db');
}

/* ------------------------------------------------------------------ *
 * SQLite backend
 * ------------------------------------------------------------------ */

async function openSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const file = sqliteFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const handle = new DatabaseSync(file);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');

  /**
   * Normalises a call into `{ sql, params }`.
   *
   * Two calling styles are supported and they must not be confused:
   *   - `query(sql, [a, b])`   → positional `?` placeholders
   *   - `query(sql, { a: 1 })` → named `$a` placeholders
   *
   * `node:sqlite` binds positional parameters when they are passed as *separate
   * arguments*, and named parameters when passed as an object. Handing it an
   * array is interpreted as a named-parameter object, which fails with
   * "Unknown named parameter '0'". Hence the spread at each call site below.
   */
  const normalise = (sql, params) => {
    if (params === undefined || params === null) return { sql, args: [] };
    if (Array.isArray(params)) {
      return { sql, args: params.map((v) => (v === undefined ? null : v)) };
    }
    if (typeof params === 'object') {
      const bound = {};
      for (const [k, v] of Object.entries(params)) {
        bound[k] = v === undefined ? null : v;
      }
      return { sql, args: [bound] };
    }
    return { sql, args: [] };
  };

  return {
    dialect: 'sqlite',
    backend: 'node:sqlite',
    file,
    handle,

    async all(sql, params) {
      const { sql: s, args } = normalise(sql, params);
      return handle.prepare(s).all(...args);
    },
    async get(sql, params) {
      const { sql: s, args } = normalise(sql, params);
      return handle.prepare(s).get(...args) ?? null;
    },
    async run(sql, params) {
      const { sql: s, args } = normalise(sql, params);
      const result = handle.prepare(s).run(...args);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    async raw(sql) {
      handle.exec(sql);
    },
    /**
     * Runs `fn` inside a transaction, passing a scoped handle.
     *
     * The scoped object is what every caller receives as `tx`, and it must expose
     * the same methods as the top-level handle. An earlier version called `fn()`
     * with no argument, so `tx.run(...)` threw on the first write of any
     * transactional route.
     *
     * `node:sqlite` is synchronous, so no connection pooling is needed; the
     * BEGIN/COMMIT bracket is enough to make the whole block atomic.
     */
    async transaction(fn) {
      const scoped = {
        dialect: 'sqlite',
        all: async (sql, params) => {
          const { sql: s, args } = normalise(sql, params);
          return handle.prepare(s).all(...args);
        },
        get: async (sql, params) => {
          const { sql: s, args } = normalise(sql, params);
          return handle.prepare(s).get(...args) ?? null;
        },
        run: async (sql, params) => {
          const { sql: s, args } = normalise(sql, params);
          const result = handle.prepare(s).run(...args);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        }
      };

      handle.exec('BEGIN');
      try {
        const out = await fn(scoped);
        handle.exec('COMMIT');
        return out;
      } catch (err) {
        handle.exec('ROLLBACK');
        throw err;
      }
    },
    async close() {
      handle.close();
    }
  };
}

/* ------------------------------------------------------------------ *
 * PostgreSQL backend
 * ------------------------------------------------------------------ */

async function openPostgres() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'nilam',
    user: process.env.PGUSER || 'nilam',
    password: process.env.PGPASSWORD || 'nilam',
    max: 10
  });

  // Fail loudly and early rather than at the first request.
  await pool.query('select 1');

  return {
    dialect: 'postgres',
    backend: 'pg',
    pool,

    async all(sql, params) {
      const res = await pool.query(sql, Array.isArray(params) ? params : []);
      return res.rows;
    },
    async get(sql, params) {
      const res = await pool.query(sql, Array.isArray(params) ? params : []);
      return res.rows[0] ?? null;
    },
    async run(sql, params) {
      const res = await pool.query(sql, Array.isArray(params) ? params : []);
      return { changes: res.rowCount, lastInsertRowid: res.rows?.[0]?.id ?? null };
    },
    async raw(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const scoped = {
          dialect: 'postgres',
          all: async (s, p) => (await client.query(s, Array.isArray(p) ? p : [])).rows,
          get: async (s, p) => (await client.query(s, Array.isArray(p) ? p : [])).rows[0] ?? null,
          run: async (s, p) => {
            const r = await client.query(s, Array.isArray(p) ? p : []);
            return { changes: r.rowCount, lastInsertRowid: r.rows?.[0]?.id ?? null };
          }
        };
        const out = await fn(scoped);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

let connection = null;

/** Opens (once) and returns the database handle for the configured dialect. */
export async function db() {
  if (connection) return connection;
  connection = DIALECT === 'postgres' ? await openPostgres() : await openSqlite();
  return connection;
}

/** Creates every table for the configured dialect. Idempotent. */
export async function migrate() {
  const { schemaStatements } = await import('./schema.mjs');
  const conn = await db();
  const statements = schemaStatements(conn.dialect);
  for (const statement of statements) {
    await conn.raw(statement);
  }
  return { dialect: conn.dialect, statements: statements.length };
}

/**
 * Translates `?` placeholders to `$1..$n` for Postgres.
 * Lets the repositories be written once with positional placeholders.
 */
export function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Rewrites a `?`-style statement for the active dialect. */
export function q(sql) {
  return DIALECT === 'postgres' ? toPostgres(sql) : sql;
}

export async function closeDb() {
  if (connection) {
    await connection.close();
    connection = null;
  }
}
