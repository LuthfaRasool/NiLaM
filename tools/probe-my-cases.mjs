// Run the exact query the /api/my/cases endpoint uses. Diagnostic only.
import { db, closeDb } from '../db/index.mjs';

const conn = await db();
const ramesh = await conn.get("select * from users where username = 'ramesh'");

const rows = await conn.all(
  `select c.id from cases c
   join parcel_owners o on o.parcel_id = c.parcel_id
   where o.user_id = ? group by c.id order by c.updated_at desc`,
  [ramesh.id]
);

console.log('endpoint query returns', rows.length, 'rows for ramesh:', rows);
await closeDb();
