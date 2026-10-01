// Why does ramesh see zero cases? Diagnostic only.
import { db, closeDb } from '../db/index.mjs';

const conn = await db();

const ramesh = await conn.get("select * from users where username = 'ramesh'");
console.log('ramesh user:', ramesh);

const owners = await conn.all('select * from parcel_owners where user_id = ?', [ramesh.id]);
console.log(`parcel_owners rows for ramesh: ${owners.length}`);
for (const o of owners) {
  console.log(`  parcel ${o.parcel_id}  owner_name=${o.owner_name}`);
  const c = await conn.get('select id, case_no, track from cases where parcel_id = ?', [o.parcel_id]);
  console.log(`    -> case ${c ? c.id + ' ' + c.case_no + ' (' + c.track + ')' : 'NONE'}`);
}

const requests = await conn.all('select * from requests where requester_id = ?', [ramesh.id]);
console.log(`requests for ramesh: ${requests.length}`);
for (const r of requests) {
  console.log(`  request ${r.id} ref=${r.reference} parcel=${r.parcel_id}`);
  const c = await conn.get('select id, case_no, track from cases where request_id = ?', [r.id]);
  console.log(`    -> case ${c ? c.id + ' ' + c.case_no + ' (' + c.track + ')' : 'NONE'}`);
}

await closeDb();
