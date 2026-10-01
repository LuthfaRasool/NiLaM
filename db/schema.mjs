/**
 * NiLaM database schema.
 *
 * Two dialects are supported from one definition:
 *
 *   - `postgres` — the deployment target. Parcels and captures carry real
 *     `geometry(...,4326)` columns with GiST indexes, and spatial predicates run
 *     in SQL via PostGIS.
 *   - `sqlite`   — the runnable substitute on a machine without a Postgres
 *     binary. Geometry is stored as GeoJSON text and the spatial predicates are
 *     evaluated by the ported geometry kernel in `packages/geometry`. The
 *     *authority* does not move: all spatial decisions still happen server-side.
 *
 * The relational shape is identical in both, so application code is written once
 * against column names and is unaware of the backend.
 */

/** Column type for a geometry field, per dialect. */
function geom(dialect, kind = 'Polygon') {
  return dialect === 'postgres' ? `geometry(${kind},4326)` : 'text';
}

function json(dialect) {
  return dialect === 'postgres' ? 'jsonb' : 'text';
}

function ts(dialect) {
  return dialect === 'postgres' ? 'timestamptz' : 'text';
}

function pk(dialect) {
  return dialect === 'postgres' ? 'bigserial primary key' : 'integer primary key autoincrement';
}

/**
 * Returns the full DDL for a dialect as an ordered list of statements.
 * Order matters: foreign keys reference earlier tables.
 */
export function schemaStatements(dialect = 'sqlite') {
  const G = (kind) => geom(dialect, kind);
  const J = json(dialect);
  const T = ts(dialect);
  const PK = pk(dialect);
  const statements = [];

  /* --- identity and access ------------------------------------------ */

  statements.push(`
    create table if not exists users (
      id ${PK},
      username text not null unique,
      password_hash text not null,
      password_salt text not null,
      full_name text not null,
      role text not null,
      designation text,
      district text,
      phone text,
      language text not null default 'en',
      -- Identity is linked by reference only. A raw Aadhaar number is never
      -- stored; DigiLocker-style flows return a token and a verified name.
      identity_provider text,
      identity_token text,
      identity_verified_at ${T},
      identity_name text,
      created_at ${T} not null
    )
  `);

  statements.push(`
    create table if not exists sessions (
      token text primary key,
      user_id integer not null references users(id),
      issued_at ${T} not null,
      expires_at ${T} not null
    )
  `);

  /* --- projects and parcels ----------------------------------------- */

  statements.push(`
    create table if not exists projects (
      id ${PK},
      code text not null unique,
      name text not null,
      track text not null,                    -- acquisition | purchase
      agency text,
      legal_track text,
      district text not null,
      state text not null,
      status text not null default 'active',
      budget_inr numeric,
      corridor ${G('MultiPolygon')},
      created_at ${T} not null,
      created_by integer references users(id)
    )
  `);

  statements.push(`
    create table if not exists villages (
      id ${PK},
      name text not null,
      taluka text not null,
      district text not null,
      state text not null,
      lgd_code text,
      guidance_rate_per_hectare numeric not null,
      boundary ${G('Polygon')},
      area_hectares numeric,
      population integer,
      households integer
    )
  `);

  statements.push(`
    create table if not exists parcels (
      id ${PK},
      survey_no text not null,
      plot_no text,
      village_id integer not null references villages(id),
      project_id integer references projects(id),
      -- "record" is the area on the Record of Rights; it is what a survey is
      -- compared against. Never overwritten by a survey result.
      record_area_hectares numeric not null,
      notified_area_hectares numeric,
      land_class text not null default 'agricultural',
      land_use text,
      guidance_rate_per_hectare numeric not null,
      irrigated integer not null default 0,
      structures text,
      trees integer default 0,
      distance_to_road_m integer,
      distance_to_town_km numeric,
      geometry ${G('Polygon')},
      centroid ${G('Point')},
      chainage_start_m integer,
      chainage_end_m integer,
      ror_year text,
      ror_on_file integer not null default 0,
      created_at ${T} not null
    )
  `);
  statements.push('create index if not exists idx_parcels_village on parcels(village_id)');
  statements.push('create index if not exists idx_parcels_project on parcels(project_id)');
  statements.push('create index if not exists idx_parcels_survey on parcels(survey_no)');

  statements.push(`
    create table if not exists parcel_owners (
      id ${PK},
      parcel_id integer not null references parcels(id),
      user_id integer references users(id),
      -- Owner identity resolved through the identity adapter: token + verified
      -- name, never a raw national identifier.
      owner_name text not null,
      guardian_name text,
      identity_provider text,
      identity_token text,
      identity_verified integer not null default 0,
      share_numerator integer not null default 1,
      share_denominator integer not null default 1,
      is_legal_heir integer not null default 0,
      contact_phone text,
      consent_state text not null default 'pending',  -- pending | consented | objected
      consent_at ${T},
      consent_note text,
      bank_account_masked text,
      bank_ifsc text,
      created_at ${T} not null
    )
  `);
  statements.push('create index if not exists idx_owners_parcel on parcel_owners(parcel_id)');

  /* --- requests (purchase track) ------------------------------------ */

  statements.push(`
    create table if not exists requests (
      id ${PK},
      reference text not null unique,
      track text not null default 'purchase',
      requester_id integer not null references users(id),
      parcel_id integer not null references parcels(id),
      project_id integer references projects(id),
      intended_use text,
      offer_amount_inr numeric,
      consideration_inr numeric,
      status text not null default 'submitted',
      current_stage text not null default 'REQUEST_SUBMITTED',
      created_at ${T} not null,
      updated_at ${T}
    )
  `);

  /* --- cases: the primary working object ---------------------------- */

  statements.push(`
    create table if not exists cases (
      id ${PK},
      case_no text not null unique,
      track text not null,                    -- acquisition | purchase
      project_id integer references projects(id),
      parcel_id integer not null references parcels(id),
      owner_id integer references parcel_owners(id),
      request_id integer references requests(id),
      stage text not null,
      stage_entered_at ${T} not null,
      priority text not null default 'normal',
      -- Officer currently holding the case, which is what makes a queue a queue.
      assigned_to integer references users(id),
      assigned_at ${T},
      decided_at ${T},
      decision text,
      decision_note text,
      area_requested_hectares numeric,
      area_surveyed_hectares numeric,
      created_at ${T} not null,
      updated_at ${T}
    )
  `);
  statements.push('create index if not exists idx_cases_stage on cases(stage)');
  statements.push('create index if not exists idx_cases_parcel on cases(parcel_id)');
  statements.push('create index if not exists idx_cases_assigned on cases(assigned_to)');
  statements.push('create index if not exists idx_cases_track on cases(track)');

  statements.push(`
    create table if not exists case_events (
      id ${PK},
      case_id integer not null references cases(id),
      at ${T} not null,
      action text not null,
      from_stage text,
      to_stage text,
      actor_id integer references users(id),
      actor_name text,
      actor_role text,
      reason text,
      detail ${J}
    )
  `);
  statements.push('create index if not exists idx_events_case on case_events(case_id)');

  /* --- clearance checks (per parcel / per owner case) --------------- */

  statements.push(`
    create table if not exists clearance_checks (
      id ${PK},
      case_id integer not null references cases(id),
      item_id text not null,
      label text not null,
      clear integer not null,
      severity text not null,
      action text,
      evidence text,
      checked_at ${T} not null
    )
  `);
  statements.push('create index if not exists idx_clearance_case on clearance_checks(case_id)');

  /* --- field verification ------------------------------------------- */

  statements.push(`
    create table if not exists field_assignments (
      id ${PK},
      case_id integer not null references cases(id),
      parcel_id integer not null references parcels(id),
      verifier_id integer references users(id),
      status text not null default 'assigned',   -- assigned | in_progress | submitted
      assigned_at ${T} not null,
      due_at ${T},
      completed_at ${T}
    )
  `);

  statements.push(`
    create table if not exists field_captures (
      id ${PK},
      capture_ref text not null unique,
      case_id integer not null references cases(id),
      parcel_id integer not null references parcels(id),
      verifier_id integer references users(id),
      verifier_name text,
      status text not null,                       -- verified | flagged
      -- Areas computed server-side from the corner ring. The client's own
      -- numbers are advisory and stored separately for comparison.
      surveyed_area_hectares numeric,
      client_area_hectares numeric,
      polygon ${G('Polygon')},
      corner_count integer not null,
      gps_flagged integer not null default 0,
      captured_at ${T} not null,
      synced_at ${T},
      synced_offline integer not null default 0,
      note text,
      device text
    )
  `);
  statements.push('create index if not exists idx_captures_case on field_captures(case_id)');

  statements.push(`
    create table if not exists field_corners (
      id ${PK},
      capture_id integer not null references field_captures(id),
      corner_index integer not null,
      latitude numeric not null,
      longitude numeric not null,
      accuracy_m numeric,
      heading_deg numeric,
      altitude_m numeric,
      point ${G('Point')},
      photo_hash text,
      photo_path text,
      captured_at ${T} not null,
      is_mock_location integer not null default 0
    )
  `);
  statements.push('create index if not exists idx_corners_capture on field_corners(capture_id)');

  statements.push(`
    create table if not exists discrepancies (
      id ${PK},
      case_id integer not null references cases(id),
      capture_id integer references field_captures(id),
      type text not null,
      severity text not null,
      detail text not null,
      measured_value numeric,
      expected_value numeric,
      delta_ratio numeric,
      detected_at ${T} not null
    )
  `);
  statements.push('create index if not exists idx_discrepancies_case on discrepancies(case_id)');

  /* --- documents ---------------------------------------------------- */

  statements.push(`
    create table if not exists documents (
      id ${PK},
      case_id integer references cases(id),
      parcel_id integer references parcels(id),
      doc_type text not null,
      title text not null,
      current_revision integer not null default 1,
      issued_to_vault integer not null default 0,
      vault_reference text,
      created_at ${T} not null
    )
  `);
  statements.push('create index if not exists idx_documents_case on documents(case_id)');

  statements.push(`
    create table if not exists document_revisions (
      id ${PK},
      document_id integer not null references documents(id),
      revision integer not null,
      body text not null,
      content_hash text not null,
      parent_hash text,
      byte_size integer not null,
      author_id integer references users(id),
      author_name text,
      author_role text,
      created_at ${T} not null
    )
  `);

  /* --- compensation, risk, payments --------------------------------- */

  statements.push(`
    create table if not exists compensation_estimates (
      id ${PK},
      case_id integer not null references cases(id),
      source text not null,                   -- calm | statutory
      model_version text,
      amount_inr numeric not null,
      amount_low_inr numeric,
      amount_high_inr numeric,
      statutory_floor_inr numeric not null,
      below_floor integer not null default 0,
      factors ${J},
      created_at ${T} not null
    )
  `);

  statements.push(`
    create table if not exists risk_scores (
      id ${PK},
      case_id integer not null references cases(id),
      model_version text,
      probability numeric not null,
      tier text not null,                     -- low | medium | high
      reasons ${J},
      recommended_action text,
      rule_baseline_score integer,
      created_at ${T} not null
    )
  `);

  statements.push(`
    create table if not exists payments (
      id ${PK},
      case_id integer not null references cases(id),
      amount_inr numeric not null,
      status text not null,                   -- advice_issued | paid | failed
      method text default 'PFMS',
      reference text,
      failure_reason text,
      advice_at ${T},
      settled_at ${T}
    )
  `);

  /* --- append-only audit ledger -------------------------------------- */

  statements.push(`
    create table if not exists audit_ledger (
      seq integer primary key,
      at ${T} not null,
      actor_id integer,
      actor_name text,
      actor_role text,
      action text not null,
      subject text,
      detail ${J},
      prev_hash text not null,
      hash text not null
    )
  `);

  /* --- offline sync bookkeeping -------------------------------------- */

  statements.push(`
    create table if not exists sync_log (
      id ${PK},
      client_id text not null,
      user_id integer references users(id),
      item_count integer not null,
      accepted integer not null default 0,
      flagged integer not null default 0,
      failed integer not null default 0,
      at ${T} not null
    )
  `);

  statements.push(`
    create table if not exists notifications (
      id ${PK},
      user_id integer not null references users(id),
      case_id integer references cases(id),
      kind text not null,
      title text not null,
      body text not null,
      -- Every notification says what happened, whether the recipient must act,
      -- and what the next step is. No opaque alert ids.
      needs_action integer not null default 0,
      next_step text,
      read_at ${T},
      created_at ${T} not null
    )
  `);

  /* --- dialect-specific index and constraint work -------------------- */

  if (dialect === 'postgres') {
    statements.push('create index if not exists idx_parcels_geom on parcels using gist(geometry)');
    statements.push('create index if not exists idx_villages_geom on villages using gist(boundary)');
    statements.push('create index if not exists idx_captures_poly on field_captures using gist(polygon)');
    statements.push('create index if not exists idx_projects_corridor on projects using gist(corridor)');
  } else {
    statements.push('create index if not exists idx_captures_status on field_captures(status)');
    statements.push('create index if not exists idx_cases_status on cases(stage, track)');
  }

  return statements;
}

/** Spatial predicate expressions that differ by dialect. */
export function spatialSql(dialect) {
  if (dialect === 'postgres') {
    return {
      areaHectares: 'ST_Area(geometry::geography) / 10000.0',
      contains: (geomExpr, lonParam, latParam) =>
        `ST_Contains(${geomExpr}, ST_SetSRID(ST_MakePoint(${lonParam}, ${latParam}), 4326))`,
      intersects: (a, b) => `ST_Intersects(${a}, ${b})`,
      distanceM: (a, b) => `ST_Distance(${a}::geography, ${b}::geography)`
    };
  }
  // SQLite: geometry is text, so the kernel does the work. These expressions are
  // placeholders so callers can be written the same way in both dialects; the
  // repository layer evaluates them in JavaScript instead.
  return {
    areaHectares: null,
    contains: null,
    intersects: null,
    distanceM: null
  };
}

export const TABLES = [
  'users', 'sessions', 'projects', 'villages', 'parcels', 'parcel_owners', 'requests',
  'cases', 'case_events', 'clearance_checks', 'field_assignments', 'field_captures',
  'field_corners', 'discrepancies', 'documents', 'document_revisions',
  'compensation_estimates', 'risk_scores', 'payments', 'audit_ledger', 'sync_log',
  'notifications'
];
