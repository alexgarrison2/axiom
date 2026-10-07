#!/usr/bin/env node
/**
 * Builds public/data/geo/north-america.json, the outline the team Schedule
 * tab's travel map draws (components/team/schedule/TravelMap.tsx).
 *
 * Source: Natural Earth 1:50m (public domain), GeoJSON from
 * github.com/nvkelso/natural-earth-vector/tree/master/geojson:
 *   ne_50m_admin_0_countries.geojson
 *   ne_50m_admin_1_states_provinces_lines.geojson
 *   ne_50m_lakes.geojson
 *
 * Usage: node scripts/build-na-geo.mjs <dir with those three files>
 *
 * Output: { v, src, land: Ring[], admin1: Line[], lakes: Ring[] } where each
 * ring/line is a flat, delta-encoded integer array of lon/lat in 1/100 degree
 * ([lon0, lat0, dLon1, dLat1, ...]). Lines are Douglas-Peucker simplified and
 * clipped to the region the map can show, so the file stays ~100 KB.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
    console.error('usage: node scripts/build-na-geo.mjs <natural-earth-geojson-dir>');
    process.exit(1);
}
const read = name => JSON.parse(fs.readFileSync(path.join(dir, `${name}.geojson`), 'utf8'));

// What the tilted map can ever show (Global Series venues sit off-map as edge markers).
const BOX = { w: -170, e: -50, s: 14, n: 72 };
const TOL = 0.06; // simplification tolerance, degrees

function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = pts[a];
        const [bx, by] = pts[b];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1e-12;
        let max = -1;
        let idx = -1;
        for (let i = a + 1; i < b; i++) {
            const [px, py] = pts[i];
            const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
            if (d > max) {
                max = d;
                idx = i;
            }
        }
        if (max > tol && idx > 0) {
            keep[idx] = 1;
            stack.push([a, idx], [idx, b]);
        }
    }
    return pts.filter((_, i) => keep[i]);
}

/** Closed rings start and end on the same point, so simplify each half. */
function simplifyRing(ring, tol) {
    const mid = Math.floor(ring.length / 2);
    return [...simplify(ring.slice(0, mid + 1), tol), ...simplify(ring.slice(mid), tol).slice(1)];
}

const inBox = ([x, y]) => x >= BOX.w && x <= BOX.e && y >= BOX.s && y <= BOX.n;
const area = ring => {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    return Math.abs(s / 2);
};

function encode(pts) {
    const out = [];
    let px = 0;
    let py = 0;
    pts.forEach(([x, y], i) => {
        const ix = Math.round(x * 100);
        const iy = Math.round(y * 100);
        if (i === 0) out.push(ix, iy);
        else out.push(ix - px, iy - py);
        px = ix;
        py = iy;
    });
    return out;
}

/** Split a line into the runs that fall inside the box (one point of slack each side). */
function clipRuns(pts) {
    const runs = [];
    let cur = [];
    pts.forEach((p, i) => {
        const near = inBox(p) || (i > 0 && inBox(pts[i - 1])) || (i < pts.length - 1 && inBox(pts[i + 1]));
        if (near) cur.push(p);
        else if (cur.length) {
            runs.push(cur);
            cur = [];
        }
    });
    if (cur.length) runs.push(cur);
    return runs.filter(r => r.length > 1);
}

const polys = geom => (geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []);
const lines = geom => (geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : []);

// Land: every country ring that touches the box (outer rings only; holes are lakes we draw separately).
const land = [];
for (const f of read('ne_50m_admin_0_countries').features) {
    for (const poly of polys(f.geometry)) {
        const ring = poly[0];
        if (!ring.some(inBox)) continue;
        if (area(ring) < 0.6) continue; // specks and small Arctic islands
        const s = simplifyRing(ring, TOL);
        if (s.length >= 4) land.push(encode(s));
    }
}

const admin1 = [];
for (const f of read('ne_50m_admin_1_states_provinces_lines').features) {
    if (!['USA', 'CAN'].includes(f.properties.ADM0_A3)) continue;
    for (const line of lines(f.geometry)) {
        for (const run of clipRuns(line)) {
            const s = simplify(run, TOL);
            if (s.length >= 2) admin1.push(encode(s));
        }
    }
}

const lakes = [];
for (const f of read('ne_50m_lakes').features) {
    if ((f.properties.scalerank ?? 9) > 1) continue;
    for (const poly of polys(f.geometry)) {
        const ring = poly[0];
        if (!ring.some(inBox) || area(ring) < 0.8) continue;
        const s = simplifyRing(ring, TOL);
        if (s.length >= 4) lakes.push(encode(s));
    }
}

const out = { v: 1, src: 'Natural Earth 1:50m (public domain), simplified', land, admin1, lakes };
const file = path.join(process.cwd(), 'public', 'data', 'geo', 'north-america.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${file}: ${(fs.statSync(file).size / 1024).toFixed(1)} KB, land ${land.length}, admin1 ${admin1.length}, lakes ${lakes.length}`);
