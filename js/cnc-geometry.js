// js/cnc-geometry.js — failu nolasīšana un ģeometrijas analīze CNC kalkulatoram
// DXF → kontūras (2D), STL/OBJ/STEP → trijstūru tīkls (3D).

function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

/* ======================================================================
   Savienoto komponentu skaitīšana (kontūru skaits pēc galapunktiem)
   ====================================================================== */
function makeUnionFind() {
  const parent = new Map();
  const key = (p) => Math.round(p[0] * 20) + ':' + Math.round(p[1] * 20); // 0,05 mm režģis
  function find(k) {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = k;
    while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  }
  function add(k) { if (!parent.has(k)) parent.set(k, k); return k; }
  return {
    join(a, b) {
      const ka = add(key(a)), kb = add(key(b));
      const ra = find(ka), rb = find(kb);
      if (ra !== rb) parent.set(ra, rb);
    },
    count() {
      const roots = new Set();
      parent.forEach((_, k) => roots.add(find(k)));
      return roots.size;
    }
  };
}

/* ======================================================================
   DXF
   ====================================================================== */
export function parseDxf(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) continue;
    pairs.push({ code, value: i + 1 < lines.length ? lines[i + 1] : '' });
    i++;
  }

  // $INSUNITS: 1 = collas, 4 = mm, 5 = cm, 6 = m
  let unitFactor = 1;
  for (let u = 0; u + 1 < pairs.length; u++) {
    if (pairs[u].code === 9 && pairs[u].value.trim().toUpperCase() === '$INSUNITS') {
      const v = parseInt(pairs[u + 1].value, 10);
      unitFactor = ({ 1: 25.4, 4: 1, 5: 10, 6: 1000 })[v] || 1;
      break;
    }
  }

  let start = -1;
  for (let s = 0; s < pairs.length; s++) {
    if (pairs[s].code === 2 && pairs[s].value.trim().toUpperCase() === 'ENTITIES') { start = s; break; }
  }
  if (start === -1) throw new Error('DXF failā nav atrasta ENTITIES sadaļa.');

  const entities = [];
  let idx = start + 1;
  while (idx < pairs.length) {
    if (pairs[idx].code === 0) {
      const type = pairs[idx].value.trim().toUpperCase();
      if (type === 'ENDSEC' || type === 'SECTION') break;
      const ent = { type, codes: {} };
      idx++;
      while (idx < pairs.length && pairs[idx].code !== 0) {
        const c = pairs[idx].code;
        (ent.codes[c] = ent.codes[c] || []).push(pairs[idx].value);
        idx++;
      }
      entities.push(ent);
    } else {
      idx++;
    }
  }

  const paths = [];   // [{ pts: [[x,y],...], closed }]
  let skipped = 0, hasBlocks = false;

  const sampleArc = (cx, cy, r, a1, a2) => {
    let delta = (a2 - a1) % 360; if (delta < 0) delta += 360; if (delta === 0) delta = 360;
    const steps = Math.max(8, Math.ceil(delta / 10));
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const a = (a1 + delta * k / steps) * Math.PI / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  };
  const bulgeArc = (p1, p2, b) => {
    if (!b) return [p1, p2];
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const c = Math.hypot(dx, dy);
    if (c === 0) return [p1, p2];
    const theta = 4 * Math.atan(Math.abs(b));
    const R = c / (2 * Math.sin(theta / 2));
    const d = R * Math.cos(theta / 2);
    const ux = dy / c, uy = -dx / c, sign = b > 0 ? 1 : -1;
    const cx = (p1[0] + p2[0]) / 2 - ux * d * sign;
    const cy = (p1[1] + p2[1]) / 2 - uy * d * sign;
    const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const a2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    let delta = b > 0 ? a2 - a1 : a1 - a2; if (delta < 0) delta += 2 * Math.PI;
    const steps = Math.max(4, Math.ceil(delta / (10 * Math.PI / 180)));
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const ang = b > 0 ? a1 + delta * k / steps : a1 - delta * k / steps;
      pts.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]);
    }
    return pts;
  };
  const bulgePoly = (pts, bulges, closed) => {
    const out = [];
    const segs = pts.length - 1 + (closed && pts.length > 2 ? 1 : 0);
    for (let q = 0; q < segs; q++) {
      const arc = bulgeArc(pts[q % pts.length], pts[(q + 1) % pts.length], q < bulges.length ? num(bulges[q]) : 0);
      for (const p of arc) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last[0] - p[0]) > 0.01 || Math.abs(last[1] - p[1]) > 0.01) out.push(p);
      }
    }
    return out;
  };
  const first = (ent, c) => num(ent.codes[c] ? ent.codes[c][0] : 0);

  for (let e = 0; e < entities.length; e++) {
    const ent = entities[e];
    switch (ent.type) {
      case 'LINE':
        paths.push({ pts: [[first(ent, 10), first(ent, 20)], [first(ent, 11), first(ent, 21)]], closed: false });
        break;
      case 'CIRCLE': {
        const pts = sampleArc(first(ent, 10), first(ent, 20), first(ent, 40), 0, 360);
        paths.push({ pts, closed: true });
        break;
      }
      case 'ARC':
        paths.push({ pts: sampleArc(first(ent, 10), first(ent, 20), first(ent, 40), first(ent, 50), first(ent, 51)), closed: false });
        break;
      case 'LWPOLYLINE': {
        const xs = ent.codes[10] || [], ys = ent.codes[20] || [];
        const pts = [];
        for (let i = 0; i < Math.min(xs.length, ys.length); i++) pts.push([num(xs[i]), num(ys[i])]);
        const closed = (first(ent, 70) & 1) !== 0;
        if (pts.length > 1) paths.push({ pts: bulgePoly(pts, ent.codes[42] || [], closed), closed });
        break;
      }
      case 'POLYLINE': {
        const pts = [], bulges = [];
        const closed = (first(ent, 70) & 1) !== 0;
        let v = e + 1;
        while (v < entities.length && entities[v].type === 'VERTEX') {
          pts.push([first(entities[v], 10), first(entities[v], 20)]);
          bulges.push(first(entities[v], 42));
          v++;
        }
        if (pts.length > 1) paths.push({ pts: bulgePoly(pts, bulges, closed), closed });
        e = v;
        break;
      }
      case 'SPLINE': {
        const fx = ent.codes[11] || [], fy = ent.codes[21] || [];
        const cx = ent.codes[10] || [], cy = ent.codes[20] || [];
        const src = fx.length >= 2 ? [fx, fy] : [cx, cy];
        const pts = [];
        for (let i = 0; i < Math.min(src[0].length, src[1].length); i++) pts.push([num(src[0][i]), num(src[1][i])]);
        const closed = (first(ent, 70) & 1) !== 0;
        if (pts.length > 1) paths.push({ pts, closed });
        break;
      }
      case 'ELLIPSE': {
        const cx = first(ent, 10), cy = first(ent, 20);
        const mx = first(ent, 11), my = first(ent, 21);
        const ratio = ent.codes[40] ? first(ent, 40) : 1;
        let t1 = ent.codes[41] ? first(ent, 41) : 0;
        let t2 = ent.codes[42] ? first(ent, 42) : 2 * Math.PI;
        if (t2 < t1) t2 += 2 * Math.PI;
        const a = Math.hypot(mx, my) || 1, b = a * ratio;
        const ux = mx / a, uy = my / a, vx = -uy, vy = ux;
        const steps = Math.max(24, Math.ceil((t2 - t1) / (8 * Math.PI / 180)));
        const pts = [];
        for (let k = 0; k <= steps; k++) {
          const t = t1 + (t2 - t1) * k / steps;
          pts.push([cx + a * Math.cos(t) * ux + b * Math.sin(t) * vx, cy + a * Math.cos(t) * uy + b * Math.sin(t) * vy]);
        }
        paths.push({ pts, closed: t2 - t1 >= 2 * Math.PI - 1e-3 });
        break;
      }
      case 'INSERT':
        hasBlocks = true;
        break;
      case 'POINT': case 'TEXT': case 'MTEXT': case 'DIMENSION': case 'HATCH': case 'LEADER':
        skipped++;
        break;
    }
  }

  // Mērvienības, garums, gabarīti, kontūru skaits
  let lengthMm = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const uf = makeUnionFind();
  let closedCount = 0;
  for (const p of paths) {
    p.pts = p.pts.map((q) => [q[0] * unitFactor, q[1] * unitFactor]);
    for (let i = 0; i < p.pts.length; i++) {
      const q = p.pts[i];
      if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
      if (i > 0) lengthMm += Math.hypot(q[0] - p.pts[i - 1][0], q[1] - p.pts[i - 1][1]);
    }
    if (p.closed && p.pts.length > 2) {
      const a = p.pts[0], b = p.pts[p.pts.length - 1];
      lengthMm += Math.hypot(a[0] - b[0], a[1] - b[1]);
      closedCount++;
    } else if (p.pts.length > 1) {
      uf.join(p.pts[0], p.pts[p.pts.length - 1]);
    }
  }
  if (!paths.length || lengthMm <= 0) throw new Error('DXF failā neatradām griežamas kontūras.');

  return {
    kind: '2d',
    paths,
    lengthMm,
    contours: closedCount + uf.count(),
    sizeX: maxX - minX,
    sizeY: maxY - minY,
    bounds: { minX, minY, maxX, maxY },
    skipped,
    hasBlocks,
    unitsKnown: true
  };
}

/* ======================================================================
   Trijstūru tīkls (STL / OBJ / STEP)
   tris: Float32Array [x1,y1,z1, x2,y2,z2, x3,y3,z3, ...]
   ====================================================================== */

// Pārkārto asis tā, lai biezuma ass būtu Z. axis: 'x' | 'y' | 'z'
export function orientTriangles(src, axis, scale) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i] * scale, y = src[i + 1] * scale, z = src[i + 2] * scale;
    if (axis === 'x') { out[i] = y; out[i + 1] = z; out[i + 2] = x; }
    else if (axis === 'y') { out[i] = z; out[i + 1] = x; out[i + 2] = y; }
    else { out[i] = x; out[i + 1] = y; out[i + 2] = z; }
  }
  return out;
}

export function meshBBox(tris) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// Mazākā gabarīta ass — parasti tā ir detaļas biezums.
export function thinnestAxis(tris) {
  const b = meshBBox(tris);
  const d = { x: b.maxX - b.minX, y: b.maxY - b.minY, z: b.maxZ - b.minZ };
  return Object.keys(d).reduce((a, k) => (d[k] < d[a] ? k : a), 'z');
}

export function analyzeMesh(tris) {
  const b = meshBBox(tris);
  const sizeZ = b.maxZ - b.minZ;
  let volume = 0, projArea = 0, finishArea = 0, surface = 0;

  // Griezuma plakne nedaudz virs apakšas — tur redzama ārējā kontūra un caurumi.
  const zCut = b.minZ + Math.min(0.5, sizeZ * 0.05);
  let sliceLen = 0;
  const uf = makeUnionFind();

  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];

    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    if (area2 === 0) continue;
    surface += area2 / 2;
    const cosZ = nz / area2;
    if (cosZ > 0) {
      projArea += nz / 2;
      // Visas nehorizontālās virsmas apdara ar lodveida frēzi (3D reljefs).
      // Pilnīgi horizontālas (augša, kabatu grīdas) un vertikālas sienas neskaita.
      if (cosZ < 0.9995 && cosZ > 0.05) finishArea += nz / 2;
    }

    // Šķēlums plaknē z = zCut
    const pts = [];
    const edge = (x1, y1, z1, x2, y2, z2) => {
      if ((z1 - zCut) * (z2 - zCut) < 0) {
        const t = (zCut - z1) / (z2 - z1);
        pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
      }
    };
    edge(ax, ay, az, bx, by, bz);
    edge(bx, by, bz, cx, cy, cz);
    edge(cx, cy, cz, ax, ay, az);
    if (pts.length === 2) {
      sliceLen += Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      uf.join(pts[0], pts[1]);
    }
  }

  volume = Math.abs(volume);
  return {
    kind: '3d',
    sizeX: b.maxX - b.minX,
    sizeY: b.maxY - b.minY,
    sizeZ,
    bbox: b,
    volumeMm3: volume,
    projAreaMm2: projArea,
    finishAreaMm2: finishArea,
    surfaceMm2: surface,
    lengthMm: sliceLen,
    contours: Math.max(1, uf.count()),
    triangleCount: tris.length / 9
  };
}

/* ======================================================================
   STEP (occt-import-js, ielādē tikai tad, ja vajag)
   ====================================================================== */
const OCCT_BASE = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';
let occtPromise = null;

function loadOcct() {
  if (occtPromise) return occtPromise;
  occtPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OCCT_BASE + 'occt-import-js.js';
    s.onload = () => {
      // eslint-disable-next-line no-undef
      occtimportjs({ locateFile: (name) => OCCT_BASE + name }).then(resolve, reject);
    };
    s.onerror = () => reject(new Error('Neizdevās ielādēt STEP lasītāju.'));
    document.head.appendChild(s);
  });
  return occtPromise;
}

export async function readStepTriangles(buffer) {
  const occt = await loadOcct();
  const res = occt.ReadStepFile(new Uint8Array(buffer), null);
  if (!res || !res.success || !res.meshes || !res.meshes.length) throw new Error('Neizdevās nolasīt ģeometriju no STEP faila.');
  let total = 0;
  for (const m of res.meshes) total += m.index.array.length;
  const out = new Float32Array(total * 3);
  let o = 0;
  for (const m of res.meshes) {
    const pos = m.attributes.position.array;
    const idx = m.index.array;
    for (let i = 0; i < idx.length; i++) {
      const k = idx[i] * 3;
      out[o++] = pos[k]; out[o++] = pos[k + 1]; out[o++] = pos[k + 2];
    }
  }
  return out;
}
