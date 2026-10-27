// js/cnc-sim.js — frēzēšanas simulācija izstrādātājam: instrumenta ceļš ar tiem pašiem laikiem kā aprēķinā
import * as THREE from 'three';
import { MACHINE } from './cnc-materials.js';

const nearest = (list, x, y) => {
  let best = 0, bd = Infinity;
  list.forEach((it, i) => { const d = Math.hypot(it.sx - x, it.sy - y); if (d < bd) { bd = d; best = i; } });
  return list.splice(best, 1)[0];
};

function circle(cx, cy, r) {
  const n = Math.max(16, Math.min(96, Math.round(r * 4)));
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
}

// Frēzes ceļa polilīnijas elementam: [{ pts, closed }]
function featurePaths(part, f, d) {
  const geo = part.geo;
  if (f.pts && f.round && f.inner) return [{ pts: circle(f.cx, f.cy, Math.max(0.1, (f.width - d) / 2)), closed: true }];
  if (f.pts) return [{ pts: f.pts, closed: true }];
  if (f.open) return geo.paths.filter((p) => !p.closed && p.pts.length > 1).map((p) => ({ pts: p.pts, closed: false }));
  return [{ pts: [[0, 0], [geo.sizeX, 0], [geo.sizeX, geo.sizeY], [0, geo.sizeY]], closed: true }];
}

/* Instrumenta ceļš vienam gabalam. Laiki sekundēs; katra elementa ilgums sakrīt ar machineMinutes(),
   tikai pārbraucieni ir pēc reāliem attālumiem, nevis pēc vidējā novērtējuma. */
export function buildToolpath(part, ctx) {
  const { g, features, planFeature, toolParams, est } = ctx;
  if (part.kind === 'mesh') return null;
  const t = part.thickness;
  const depth = t + MACHINE.throughCutMm;
  const safeZ = t + MACHINE.safeZMm;
  const halfZ = (t + MACHINE.safeZMm) / MACHINE.zRapidFeed * 60;   // s — viena Z kustība (lejup vai augšup)
  const withFinish = t >= MACHINE.finishPassMinT;

  const T = [], X = [], Y = [], Z = [], C = [];
  const ops = [];
  let now = 0, x = 0, y = 0, z = safeZ, rapidS = 0;
  const push = (nx, ny, nz, dur, cut) => { now += dur; x = nx; y = ny; z = nz; T.push(now); X.push(x); Y.push(y); Z.push(z); C.push(cut ? 1 : 0); };
  const dwell = (dur) => { if (dur > 0) push(x, y, z, dur, false); };
  const op = (label, tool) => ops.push({ start: now, label, tool });
  const rapidTo = (nx, ny) => {
    const dur = Math.hypot(nx - x, ny - y) / MACHINE.rapidFeed * 60;
    if (dur > 0) { rapidS += dur; push(nx, ny, safeZ, dur, false); }
  };

  // Elementi grupās pēc instrumenta
  const items = features.map((f) => {
    const plan = planFeature(f, g, depth);
    const d = plan.kind === 'drill' ? plan.d : plan.tool.d;
    const paths = plan.kind === 'drill' ? [] : featurePaths(part, f, d);
    const sx = plan.kind === 'drill' ? f.cx : paths[0] ? paths[0].pts[0][0] : 0;
    const sy = plan.kind === 'drill' ? f.cy : paths[0] ? paths[0].pts[0][1] : 0;
    const key = plan.kind === 'drill' ? 'a' + String(d * 10).padStart(5, '0')
      : plan.tool.d !== g.baseTool ? 'b' + String(d * 10).padStart(5, '0') : f.inner ? 'c' : 'd';
    return { f, plan, d, paths, sx, sy, key };
  }).filter((it) => it.plan.kind === 'drill' ? Number.isFinite(it.sx) : it.paths.length);

  // Tiltiņus atstāj lielākajā ārējā kontūrā
  const outer = items.filter((it) => !it.f.inner && it.plan.kind === 'mill');
  const tabHost = outer.reduce((a, b) => (!a || b.f.perimeter > a.f.perimeter ? b : a), null);
  const tabCount = est.stats.tabCount || 0;

  const keys = Array.from(new Set(items.map((it) => it.key))).sort();
  const b = part.geo.bounds || { minX: 0, minY: 0 };
  x = b.minX; y = b.minY;
  push(x, y, z, 0, false);

  let prevTool = '';
  keys.forEach((key) => {
    const group = items.filter((it) => it.key === key);
    const first = group[0];
    const toolName = first.plan.kind === 'drill' ? 'Urbis Ø' + first.d : 'Frēze Ø' + first.d;
    const tool = first.plan.kind === 'drill'
      ? { kind: 'drill', d: first.d, flute: Math.min(60, Math.max(12, 10 * first.d)) }
      : { kind: 'mill', d: first.d, flute: first.plan.tool.flute };
    // Iekšējās un ārējās kontūras ar pamata frēzi – bez maiņas
    if (prevTool && prevTool !== toolName) { op('Instrumenta maiņa → ' + toolName, tool); dwell(MACHINE.toolChangeS); }
    prevTool = toolName;

    let n = 0;
    while (group.length) {
      const it = nearest(group, x, y);
      n++;
      const total = n + group.length;
      if (it.plan.kind === 'drill') {
        op(toolName + ' · urbums ' + n + '/' + total, tool);
        const dDepth = t + 1;
        const pecks = Math.max(0, Math.ceil(dDepth / (3 * it.d)) - 1);
        rapidTo(it.sx, it.sy);
        push(x, y, t, halfZ + MACHINE.drillApproachS, false);
        push(x, y, t - dDepth, dDepth / g.drillFeed * 60 + pecks * MACHINE.peckS, true);
        push(x, y, safeZ, halfZ, false);
        continue;
      }

      const f = it.f;
      const tp = toolParams(g, it.d);
      const passes = Math.max(1, Math.ceil(depth / tp.ap));
      const pathLen = f.round && f.inner ? Math.max(0.5, Math.PI * (f.width - tp.d)) : f.perimeter;
      const pathR = f.round && f.inner ? Math.max(0.2, (f.width - tp.d) / 2) : f.inner ? Math.max(0.5, f.perimeter / (2 * Math.PI)) : Infinity;
      const v = Math.min(tp.feed, Math.sqrt(MACHINE.accel * pathR) * 60);
      const traverseS = (pathLen + MACHINE.leadInMm) / v * 60 / MACHINE.efficiency;
      const what = f.inner ? (f.round ? 'caurums' : 'iekšējā kontūra') : 'ārējā kontūra';
      const geomLen = it.paths.reduce((s, p) => s + p.pts.reduce((a, q, i) => {
        const r = p.pts[(i + 1) % p.pts.length];
        return i === p.pts.length - 1 && !p.closed ? a : a + Math.hypot(r[0] - q[0], r[1] - q[1]);
      }, 0), 0) || 1;

      // Viens apgājiens pa visām polilīnijām dotajā dziļumā, kopā traverseS sekundēs
      const traverse = (zz) => {
        it.paths.forEach((p, pi) => {
          if (pi > 0) push(p.pts[0][0], p.pts[0][1], zz, 0, false);
          const m = p.pts.length;
          const last = p.closed ? m : m - 1;
          for (let i = 1; i <= last; i++) {
            const q = p.pts[i % m];
            push(q[0], q[1], zz, Math.hypot(q[0] - x, q[1] - y) / geomLen * traverseS, true);
          }
        });
      };

      rapidTo(it.sx, it.sy);
      push(x, y, t, halfZ, false);
      for (let k = 1; k <= passes; k++) {
        op(toolName + ' · ' + what + ' ' + n + '/' + total + ' · gājiens ' + k + '/' + passes, { ...tool, d: it.d });
        const zk = t - depth * k / passes;
        push(it.sx, it.sy, zk, (depth / passes) / tp.plunge * 60 + MACHINE.passOverheadS, true);
        traverse(zk);
      }
      if (it === tabHost && tabCount) {
        op(toolName + ' · tiltiņi (' + tabCount + ')', tool);
        dwell(tabCount * MACHINE.tabMachineS);
      }
      dwell(MACHINE.contourOverheadS);
      push(x, y, safeZ, halfZ, false);
      if (withFinish) {
        op(toolName + ' · ' + what + ' ' + n + '/' + total + ' · apdares gājiens', tool);
        push(it.sx, it.sy, -MACHINE.throughCutMm, halfZ + MACHINE.passOverheadS, false);
        traverse(-MACHINE.throughCutMm);
        push(x, y, safeZ, halfZ, false);
      }
    }
  });

  const machineEnd = now;
  const manualTabsS = Math.max(0, (est.time.tabs - tabCount * MACHINE.tabMachineS / 60) * 60);
  op(tabCount ? 'Roku darbs: detaļas noņemšana, ' + tabCount + ' tiltiņu nogriešana' : 'Roku darbs: detaļas noņemšana', null);
  dwell(MACHINE.handlingMin * 60 + manualTabsS);

  return {
    T: Float64Array.from(T), X: Float32Array.from(X), Y: Float32Array.from(Y), Z: Float32Array.from(Z), C: Uint8Array.from(C),
    ops, total: now, machineEnd, rapidS,
    modelS: (est.minutes + est.toolChangeMin) * 60,
    modelRapidS: est.time.rapid * 60
  };
}

/* Trīsdimensiju skats: plānotais ceļš, nogrieztais ceļš un instruments */
export class SimView {
  constructor(path) {
    this.path = path;
    this.time = 0;
    this.speed = 1;
    this.playing = false;
    this.group = new THREE.Group();
    const { T, X, Y, Z, C } = path;

    // Griešanas pāri laika secībā
    const cut = [], cutEnd = [], rapid = [];
    for (let i = 1; i < T.length; i++) {
      const moved = X[i] !== X[i - 1] || Y[i] !== Y[i - 1] || Z[i] !== Z[i - 1];
      if (!moved) continue;
      const seg = [X[i - 1], Y[i - 1], Z[i - 1], X[i], Y[i], Z[i]];
      if (C[i]) { cut.push(...seg); cutEnd.push(T[i]); } else rapid.push(...seg);
    }
    this.cutEnd = Float64Array.from(cutEnd);

    const lines = (arr, color, opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(arr), 3));
      const obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: opacity === 1 }));
      this.group.add(obj);
      return obj;
    };
    lines(cut, 0x182120, 0.12);
    lines(rapid, 0x2f6fb0, 0.35);
    this.done = lines(cut, 0xb64a1b, 1);
    this.done.geometry.setDrawRange(0, 0);

    const curGeo = new THREE.BufferGeometry();
    curGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.current = new THREE.Line(curGeo, new THREE.LineBasicMaterial({ color: 0xb64a1b }));
    this.group.add(this.current);

    // Instruments: griezējdaļa + cangas uzgrieznis; ass pa Z, gals punktā (0,0,0)
    this.tool = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 0.85, roughness: 0.3 });
    this.cutter = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24).rotateX(Math.PI / 2).translate(0, 0, 0.5), steel);
    this.nut = new THREE.Mesh(new THREE.CylinderGeometry(14, 16, 22, 6).rotateX(Math.PI / 2).translate(0, 0, 11),
      new THREE.MeshStandardMaterial({ color: 0x3a4240, metalness: 0.6, roughness: 0.4 }));
    this.tool.add(this.cutter, this.nut);
    this.group.add(this.tool);
    this.toolKey = '';
    this.apply();
  }

  opAt(time) {
    const ops = this.path.ops;
    let lo = 0, hi = ops.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ops[mid].start <= time) lo = mid; else hi = mid - 1; }
    return ops[lo];
  }

  seek(time) { this.time = Math.max(0, Math.min(this.path.total, time)); this.apply(); }

  update(dt) {
    if (!this.playing) return;
    this.time += dt * this.speed;
    if (this.time >= this.path.total) { this.time = this.path.total; this.playing = false; }
    this.apply();
  }

  apply() {
    const { T, X, Y, Z, C } = this.path;
    const tm = this.time;
    let lo = 1, hi = T.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < tm) lo = mid + 1; else hi = mid; }
    const i = Math.min(lo, T.length - 1);
    const span = T[i] - T[i - 1];
    const k = span > 0 ? Math.max(0, Math.min(1, (tm - T[i - 1]) / span)) : 1;
    const px = X[i - 1] + (X[i] - X[i - 1]) * k, py = Y[i - 1] + (Y[i] - Y[i - 1]) * k, pz = Z[i - 1] + (Z[i] - Z[i - 1]) * k;
    this.tool.position.set(px, py, pz);

    // Pabeigtie griešanas posmi + pašreizējais
    let a = 0, b = this.cutEnd.length;
    while (a < b) { const mid = (a + b) >> 1; if (this.cutEnd[mid] <= tm) a = mid + 1; else b = mid; }
    this.done.geometry.setDrawRange(0, a * 2);
    const pos = this.current.geometry.attributes.position;
    if (C[i] && k < 1) pos.array.set([X[i - 1], Y[i - 1], Z[i - 1], px, py, pz]); else pos.array.fill(0);
    pos.needsUpdate = true;
    this.current.visible = !!(C[i] && k < 1);

    const op = this.opAt(tm);
    const tool = op && op.tool;
    const key = tool ? tool.kind + tool.d : 'none';
    if (key !== this.toolKey) {
      this.toolKey = key;
      if (tool) this.cutter.scale.set(tool.d / 2, tool.d / 2, tool.flute);
      this.nut.position.z = tool ? tool.flute : 20;
      this.cutter.visible = !!tool;
    }
  }

  dispose() { this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
}
