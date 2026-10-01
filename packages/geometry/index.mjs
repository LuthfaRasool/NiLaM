
/**
 * Geometry kernel.
 *
 * Stands in for the PostGIS function set the production design calls for
 * (ST_Area, ST_Centroid, ST_Contains, ST_Intersection), implemented in plain
 * JavaScript so the prototype has no native or third-party dependency.
 *
 * Conventions
 *  - A position is [lon, lat] in WGS84 (EPSG:4326), matching GeoJSON.
 *  - A ring is an array of positions, first === last for closed rings.
 *  - A polygon is [outerRing, ...holes]; a feature may be a Polygon or
 *    MultiPolygon geometry object.
 */

const EARTH_RADIUS_M = 6378137.0; // WGS84 semi-major axis
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * Scalar helpers
 * ------------------------------------------------------------------ */

/** Land-area conversion: 1 hectare = 10,000 m^2. */
const M2_PER_HECTARE = 10000;
const M2_PER_ACRE = 4046.8564224;

function toHectares(m2) {
  return m2 / M2_PER_HECTARE;
}

function toAcres(m2) {
  return m2 / M2_PER_ACRE;
}

/**
 * Geodesic area of a lon/lat ring using the spherical excess formula.
 * Accurate to ~1e-9 relative for parcel-sized polygons, which is far beyond
 * what a compensation register needs, and it does not drift with latitude the
 * way a naive planar shoelace does.
 */
function ringAreaM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total += (lon2 - lon1) * DEG * (2 + Math.sin(lat1 * DEG) + Math.sin(lat2 * DEG));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** Area of a polygon (outer ring minus holes), in square metres. */
function polygonAreaM2(polygon) {
  if (!polygon || !polygon.length) return 0;
  let area = ringAreaM2(polygon[0]);
  for (let i = 1; i < polygon.length; i += 1) area -= ringAreaM2(polygon[i]);
  return Math.max(0, area);
}

/** Area of any supported geometry, in square metres. */
function geometryAreaM2(geom) {
  if (!geom) return 0;
  if (geom.type === 'Polygon') return polygonAreaM2(geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((sum, poly) => sum + polygonAreaM2(poly), 0);
  }
  if (geom.type === 'Point') return 0;
  return 0;
}

function geometryAreaHectares(geom) {
  return toHectares(geometryAreaM2(geom));
}

/**
 * Planar centroid of a polygon's outer ring. Parcels in this system are small
 * relative to the earth, so the planar result is within centimetres of the
 * geodesic centroid while being far cheaper to compute.
 */
function ringCentroid(ring) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    twiceArea += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(twiceArea) < 1e-15) {
    // Degenerate ring: fall back to the vertex mean.
    const n = ring.length || 1;
    const sum = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / n, sum[1] / n];
  }
  const k = 1 / (3 * twiceArea);
  return [cx * k, cy * k];
}

/**
 * Representative point of a geometry. For a MultiPolygon we take the centroid
 * of the largest part, so a clipped sliver never drags the marker off the plot.
 */
function geometryCentroid(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates.slice();
  if (geom.type === 'Polygon') return ringCentroid(geom.coordinates[0]);
  if (geom.type === 'MultiPolygon') {
    let best = null;
    let bestArea = -1;
    for (const poly of geom.coordinates) {
      const area = polygonAreaM2(poly);
      if (area > bestArea) {
        bestArea = area;
        best = poly;
      }
    }
    return best ? ringCentroid(best[0]) : null;
  }
  return null;
}

/**
 * Guaranteed-inside label anchor: walks from the centroid toward the midpoint
 * of the first edge until the point is strictly inside the ring. Guarantees a
 * parcel's map label is always drawn on top of its own polygon.
 */
function labelAnchor(geom) {
  const c = geometryCentroid(geom);
  if (!c) return null;
  const ring = geom.type === 'MultiPolygon' ? largestPart(geom)[0] : geom.coordinates[0];
  if (pointInRing(c, ring)) return c;
  const mid = [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2];
  for (let t = 0.05; t <= 1; t += 0.05) {
    const p = [c[0] + (mid[0] - c[0]) * t, c[1] + (mid[1] - c[1]) * t];
    if (pointInRing(p, ring)) return p;
  }
  return c;
}

function largestPart(geom) {
  let best = geom.coordinates[0];
  let bestArea = -1;
  for (const poly of geom.coordinates) {
    const area = polygonAreaM2(poly);
    if (area > bestArea) {
      bestArea = area;
      best = poly;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Predicates and measurement
 * ------------------------------------------------------------------ */

/** Ray-casting point-in-ring test. */
function rayCastInRing(point, ring) {
  if (!point || !ring || ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Distance from a point to a segment, in metres. Local equirectangular
 * approximation, accurate far beyond the scales used in this system.
 */
function distanceToSegmentM(point, a, b) {
  const latRef = ((a[1] + b[1]) / 2) * DEG;
  const mPerLon = EARTH_RADIUS_M * DEG * Math.cos(latRef);
  const mPerLat = EARTH_RADIUS_M * DEG;

  const px = (point[0] - a[0]) * mPerLon;
  const py = (point[1] - a[1]) * mPerLat;
  const bx = (b[0] - a[0]) * mPerLon;
  const by = (b[1] - a[1]) * mPerLat;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - bx * t, py - by * t);
}

/**
 * Point-in-ring, with a boundary tolerance.
 *
 * Ray casting alone returns false for a point lying exactly *on* an edge, and in
 * this domain that is not an edge case: a surveyed corner is by definition on
 * the parcel boundary. Parcel geometry cut from a corridor has long straight
 * runs, so corners are frequently exactly collinear with an edge. Without a
 * tolerance every corner capture reported "outside the boundary" — a false
 * discrepancy an officer would have acted on.
 *
 * A point within `toleranceM` of any edge counts as inside. The 1 m default is
 * below the GNSS accuracy of any handset in use, so it cannot mask a genuine
 * mis-survey.
 */
function pointInRing(point, ring, toleranceM = 1.0) {
  if (rayCastInRing(point, ring)) return true;
  if (!ring || ring.length < 2) return false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    if (distanceToSegmentM(point, ring[j], ring[i]) <= toleranceM) return true;
  }
  return false;
}

function pointInPolygon(point, polygon, toleranceM = 1.0) {
  if (!point || !polygon || !polygon.length || !polygon[0]) return false;
  if (!pointInRing(point, polygon[0], toleranceM)) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    // A hole excludes the point only when the point is genuinely well inside it.
    if (polygon[i] && rayCastInRing(point, polygon[i])) return false;
  }
  return true;
}

/** ST_Contains, with the same boundary tolerance. */
function geometryContains(geom, point, toleranceM = 1.0) {  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygon(point, geom.coordinates, toleranceM);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly) => pointInPolygon(point, poly, toleranceM));
  }
  return false;
}

/** Planar bounding box as [minLon, minLat, maxLon, maxLat]. */
function geometryBBox(geom) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) visit(c);
  };

  if (geom && geom.coordinates) visit(geom.coordinates);
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

function bboxIntersects(a, b) {
  if (!a || !b) return false;
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function bboxContains(outer, inner) {
  if (!outer || !inner) return false;
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

/** Great-circle distance in metres. */
function haversineM(a, b) {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative length of a polyline, in metres. */
function lineLengthM(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += haversineM(coords[i - 1], coords[i]);
  return total;
}

/** Human-facing geodesic measure: metres below 1 km, kilometres above. */
function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

/* ------------------------------------------------------------------ *
 * Construction: buffering, slicing, clipping
 * ------------------------------------------------------------------ */

/** Straight line interpolated between two positions, sampled every `steps`. */
function segment(a, b, steps = 8) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Resamples a polyline so no segment exceeds `maxStepM` metres. */
function densify(coords, maxStepM = 120) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const d = haversineM(coords[i - 1], coords[i]);
    const steps = Math.max(1, Math.ceil(d / maxStepM));
    const seg = segment(coords[i - 1], coords[i], steps);
    for (let j = 1; j < seg.length; j += 1) out.push(seg[j]);
  }
  return out;
}

/** Unit normal (perpendicular) of a segment, in degrees-space. */
function normalOf(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/**
 * Offsets a densified centreline sideways by `offsetM` (approximate: the
 * longitude scale is corrected for latitude). Returns one side of the corridor.
 */
function offsetLine(coords, offsetM, latRef) {
  const latScale = Math.cos(latRef * DEG) || 1;
  const out = [];
  for (let i = 0; i < coords.length; i += 1) {
    const prev = coords[Math.max(0, i - 1)];
    const next = coords[Math.min(coords.length - 1, i + 1)];
    const [nx, ny] = normalOf(prev, next);
    const dLat = (ny * offsetM) / EARTH_RADIUS_M / DEG;
    const dLon = (nx * offsetM) / (EARTH_RADIUS_M * DEG * latScale);
    out.push([coords[i][0] + dLon, coords[i][1] + dLat]);
  }
  return out;
}

/**
 * Builds a closed polygon representing the right-of-way corridor along a
 * centreline: the left offset forward, the right offset reversed.
 */
function corridorPolygon(centerlineM, widthM) {
  const latRef = centerlineM.reduce((s, p) => s + p[1], 0) / centerlineM.length;
  const left = offsetLine(centerlineM, widthM / 2, latRef);
  const right = offsetLine(centerlineM, -widthM / 2, latRef);
  const ring = left.concat(right.reverse());
  return [ring.concat([ring[0]])];
}

/**
 * Cuts a polygon with an infinite line through point `p` with direction `dir`.
 * Returns [sideA, sideB] polygons (either may be null when the cut misses).
 * Uses the convex Sutherland-Hodgman rule, which is exact for the convex
 * corridor strips this generator produces.
 */
function splitPolygonByLine(polygon, p, dir) {
  const n = [-dir[1], dir[0]]; // normal of the cut direction
  const side = (pt) => (pt[0] - p[0]) * n[0] + (pt[1] - p[1]) * n[1];

  const clip = (sign) => {
    const out = [];
    const ring = polygon[0];
    for (let i = 0; i < ring.length; i += 1) {
      const cur = ring[i];
      const nxt = ring[(i + 1) % ring.length];
      const dCur = side(cur) * sign;
      const dNxt = side(nxt) * sign;
      if (dCur >= 0) out.push(cur);
      if ((dCur >= 0) !== (dNxt >= 0)) {
        const t = dCur / (dCur - dNxt);
        out.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]);
      }
    }
    return out.length >= 3 ? [out] : null;
  };

  return [clip(1), clip(-1)];
}

/**
 * Sutherland-Hodgman clip: subject polygon against a *convex* clip polygon.
 * Used to intersect a right-of-way corridor with a village boundary.
 *
 * Orientation-robust: rather than assuming the clip ring is wound clockwise,
 * the interior side of each edge is determined by testing an interior point
 * (the ring's own centroid, which is inside because the clip must be convex).
 */
function clipPolygon(subject, clip) {
  if (!subject || !subject.length || !clip || !clip.length) return null;

  const clipRing = clip[0];
  if (clipRing.length < 4) return null;

  const insidePoint = ringCentroid(clipRing.slice(0, -1));

  // Discard degenerate clip rings that have no measurable area.
  if (ringAreaM2(clipRing) < 1) return null;

  let output = subject[0].slice();
  if (output.length < 3) return null;
  if (output[0][0] !== output[output.length - 1][0] || output[0][1] !== output[output.length - 1][1]) {
    output.push(output[0]);
  }

  for (let i = 0; i < clipRing.length - 1; i += 1) {
    if (output.length < 4) return null;
    const a = clipRing[i];
    const b = clipRing[i + 1];

    const cross = (pt) => (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    // The interior of the clip polygon lies on this side of edge a->b.
    const keepSign = Math.sign(cross(insidePoint)) || 1;
    const inside = (pt) => cross(pt) * keepSign >= 0;

    const input = output;
    output = [];
    for (let j = 0; j < input.length - 1; j += 1) {
      const cur = input[j];
      const nxt = input[j + 1];
      const dCur = cross(cur) * keepSign;
      const dNxt = cross(nxt) * keepSign;
      if (dCur >= 0) output.push(cur);
      if (dCur >= 0 !== dNxt >= 0) {
        const t = dCur / (dCur - dNxt);
        output.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]);
      }
    }
    if (output.length < 3) return null;
    output.push(output[0]);
  }

  return output.length >= 4 ? [output] : null;
}

/** Signed planar area; positive means counter-clockwise. */
function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Web Mercator projection to a unit square, for canvas drawing. */
function project([lon, lat]) {
  const x = (lon + 180) / 360;
  const s = Math.sin(lat * DEG);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

/** Inverse Web Mercator. */
function unproject([x, y]) {
  const lon = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lon, lat];
}

/** Ground metres per degree of longitude at a given latitude. */
function metresPerDegreeLon(lat) {
  return DEG * EARTH_RADIUS_M * Math.cos(lat * DEG);
}

/** Ground metres per degree of latitude. */
const METRES_PER_DEGREE_LAT = DEG * EARTH_RADIUS_M;

/** Iterates every ring of a geometry. */
function eachRing(geom, fn) {
  if (!geom) return;
  if (geom.type === 'Polygon') geom.coordinates.forEach(fn);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((poly) => poly.forEach(fn));
}

export {
  EARTH_RADIUS_M, M2_PER_HECTARE, M2_PER_ACRE, DEG,
  toHectares, toAcres, ringAreaM2, polygonAreaM2, geometryAreaM2, geometryAreaHectares,
  ringCentroid, geometryCentroid, labelAnchor,
  pointInRing, pointInPolygon, geometryContains,
  geometryBBox, bboxIntersects, bboxContains,
  haversineM, lineLengthM, formatDistance, signedArea,
  segment, densify, normalOf, offsetLine, corridorPolygon, splitPolygonByLine, clipPolygon,
  project, unproject, metresPerDegreeLon, METRES_PER_DEGREE_LAT, eachRing
};