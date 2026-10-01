/**
 * Applies the schema for the configured dialect.
 *
 * Usage: node db/migrate.mjs [--reset]
 *
 * `--reset` drops the SQLite file first, which is how the demo is made
 * reproducible. It refuses to run against Postgres, because dropping a real
 * database because of a stray flag is not a mistake worth enabling.
 */

import fs from 'node:fs';
import { db, migrate, closeDb, DIALECT } from './index.mjs';

const reset = process.argv.includes('--reset');

if (reset) {
  if (DIALECT === 'postgres') {
    console.error('Refusing to --reset a Postgres database. Drop it yourself if that is what you want.');
    process.exit(1);
  }
  const conn = await db();
  const file = conn.file;
  await closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* a missing sidecar file is fine */
    }
  }
  console.log(`reset: removed ${file}`);
}

const result = await migrate();
console.log(`NiLaM schema applied`);
console.log(`  dialect    : ${result.dialect}`);
console.log(`  statements : ${result.statements}`);

const conn = await db();
const rows = await conn.all(
  "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
).catch(async () => {
  // Postgres path
  return conn.all("select tablename as name from pg_tables where schemaname='public' order by tablename");
});
console.log(`  tables     : ${rows.length}`);
console.log('  ' + rows.map((r) => r.name).join(', '));

const ledger = await conn.get('select count(*) as n from audit_ledger');
console.log(`  ledger rows: ${ledger.n}`);

await closeDb();
