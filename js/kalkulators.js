/* ==========================================================================
   CNC PAKALPOJUMI — kalkulatora skripts
   --------------------------------------------------------------------------
   Divi režīmi vienā failā:
     1. Faila bāzēts kalkulators (/kalkulators/) — DXF / STL / STEP parsēšana
        pārlūkā, bez backend un bez ārējām bibliotēkām.
     2. Vienkāršais manuālais kalkulators (sākumlapa) — nemainīta loģika.
   ========================================================================== */

(function () {
  'use strict';

  var isFileCalc = !!document.getElementById('calc-dropzone');

  if (isFileCalc) {
    initFileCalculator();
  } else {
    initLegacyCalculator();
  }

  /* ======================================================================
     FAILA BĀZĒTS KALKULATORS
     ====================================================================== */
  function initFileCalculator() {
    var CONFIG = {
      hourlyRate: 45,        // EUR/h mašīnlaiks
      setupMinutes: 20,      // sagatavošana uz pasūtījumu
      minOrderEur: 25,       // minimālā pasūtījuma summa
      toolingRate: 0.12,     // instrumentu nodilums, % no mašīnlaika izmaksām
      marginRate: 0.10,      // uzlikums
      efficiency: 0.75,      // reālais laiks pret teorētisko
      rapidFeed: 12000,      // mm/min pārvietošanās
      plungeFeed: 800,       // mm/min iegremdēšana
      stockMarginMm: 10,     // materiāla rezerve katrā pusē
      leadInMm: 8,           // ieeja/izeja uz kontūru
      qtyDiscount: [[1, 1.00], [5, 0.95], [10, 0.90], [25, 0.85], [50, 0.80], [100, 0.75]],
      maxBedX: 2500, maxBedY: 1300, maxZ: 100,
      contactEmail: 'razosana@bratus.lv',
      formEndpoint: ''       // tukšs = mailto; citādi Formspree URL
    };

    var MATERIALS = {
      wood:     { label: 'Koks / MDF / Saplāksnis', feed: 4000, ap: 8.0, mrr: 80, finishFeed: 5000, stepover: 1.5, eurPerM2Mm: 0.75, toolFactor: 1.0 },
      plastic:  { label: 'Plastmasa / Akrils / Kompozīti', feed: 2500, ap: 4.0, mrr: 30, finishFeed: 3000, stepover: 1.0, eurPerM2Mm: 6.00, toolFactor: 1.3 },
      aluminum: { label: 'Alumīnijs / Mīkstie metāli', feed: 1200, ap: 1.5, mrr: 8, finishFeed: 1500, stepover: 0.6, eurPerM2Mm: 12.0, toolFactor: 2.2 }
    };

    /* ----- Palīgfunkcijas ----- */
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function roundUp50(v) { return Math.ceil(v / 0.5) * 0.5; }
    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

    var currencyFmt = new Intl.NumberFormat('lv-LV', { style: 'currency', currency: 'EUR' });
    function fmtCurrency(v) { return currencyFmt.format(v); }

    function fmtMinutes(min) {
      var rounded = Math.max(1, Math.round(min));
      if (rounded < 60) return rounded + ' min';
      var h = Math.floor(rounded / 60);
      var m = rounded % 60;
      return h + ' h' + (m ? ' ' + m + ' min' : '');
    }

    function fmtSize(bytes) {
      if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
      if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
      return bytes + ' B';
    }

    function fmtDim(mm) {
      return String(Math.round(mm * 10) / 10).replace('.', ',') + ' mm';
    }

    function fmtLength(mm) {
      if (mm >= 1000) return (mm / 1000).toFixed(1).replace('.', ',') + ' m';
      return Math.round(mm) + ' mm';
    }

    function fmtVolume(mm3) {
      var cm3 = mm3 / 1000;
      if (cm3 >= 1000) return (cm3 / 1000).toFixed(1).replace('.', ',') + ' l';
      return Math.round(cm3) + ' cm³';
    }

    function unitFactor() { return parseFloat(unitsEl.value) || 1; }

    function qtyDiscount(qty) {
      var d = 1;
      for (var i = 0; i < CONFIG.qtyDiscount.length; i++) {
        if (qty >= CONFIG.qtyDiscount[i][0]) d = CONFIG.qtyDiscount[i][1];
      }
      return d;
    }

    /* ----- DXF parsētājs ----- */
    function parseDxf(text) {
      var lines = text.split(/\r\n|\r|\n/);
      var pairs = [];
      var i;
      for (i = 0; i < lines.length; i++) {
        var code = parseInt(lines[i].trim(), 10);
        if (isNaN(code)) continue;
        pairs.push({ code: code, value: i + 1 < lines.length ? lines[i + 1] : '' });
        i++;
      }

      var unitFactor = 1;
      for (var u = 0; u + 1 < pairs.length; u++) {
        if (pairs[u].code === 9 && pairs[u].value.trim().toUpperCase() === '$INSUNITS') {
          if (pairs[u + 1].code === 70) {
            unitFactor = (parseInt(pairs[u + 1].value, 10) === 1) ? 25.4 : 1;
          }
          break;
        }
      }

      var start = -1;
      for (var s = 0; s < pairs.length; s++) {
        if (pairs[s].code === 2 && pairs[s].value.trim().toUpperCase() === 'ENTITIES') { start = s; break; }
      }
      if (start === -1) {
        return { kind: 'dxf', lengthMm: 0, bbox: { x: 0, y: 0 }, contourCount: 0, skipped: 0, hasBlocks: false, unitFactor: unitFactor, paths: [] };
      }

      var entities = [];
      var idx = start + 1;
      while (idx < pairs.length) {
        if (pairs[idx].code === 0) {
          var type = pairs[idx].value.trim().toUpperCase();
          if (type === 'ENDSEC' || type === 'SECTION') break;
          var ent = { type: type, codes: {} };
          idx++;
          while (idx < pairs.length && pairs[idx].code !== 0) {
            var c = pairs[idx].code;
            if (!ent.codes[c]) ent.codes[c] = [];
            ent.codes[c].push(pairs[idx].value);
            idx++;
          }
          entities.push(ent);
        } else {
          idx++;
        }
      }

      var lengthMm = 0, contourCount = 0, skipped = 0, hasBlocks = false;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      function bbox(x, y) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      function polyLen(pts, closed, factor) {
        var len = 0;
        for (var p = 0; p < pts.length - 1; p++) {
          len += Math.hypot(pts[p + 1][0] - pts[p][0], pts[p + 1][1] - pts[p][1]);
        }
        if (closed && pts.length > 2) {
          len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
        }
        return len * factor;
      }
      function segLen(p1, p2, bulge) {
        var chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        if (!bulge || chord === 0) return chord;
        var theta = 4 * Math.atan(Math.abs(bulge));
        var R = chord / (2 * Math.sin(theta / 2));
        return R * theta;
      }
      function lwLen(pts, bulges, closed, factor) {
        var len = 0;
        var segCount = pts.length - 1 + (closed && pts.length > 2 ? 1 : 0);
        for (var p = 0; p < segCount; p++) {
          var a = pts[p % pts.length];
          var b = pts[(p + 1) % pts.length];
          var bl = p < bulges.length ? num(bulges[p]) : 0;
          len += segLen(a, b, bl);
        }
        return len * factor;
      }

      var paths = [];
      function addPath(pts, closed) {
        if (!pts || pts.length < 1) return;
        var d = 'M' + (pts[0][0] * unitFactor).toFixed(2) + ' ' + (-pts[0][1] * unitFactor).toFixed(2);
        for (var q = 1; q < pts.length; q++) {
          d += 'L' + (pts[q][0] * unitFactor).toFixed(2) + ' ' + (-pts[q][1] * unitFactor).toFixed(2);
        }
        if (closed && pts.length > 2) d += 'Z';
        paths.push(d);
      }
      function sampleCircle(cx, cy, r) {
        var pts = [];
        var steps = Math.max(24, Math.ceil(Math.abs(r) / 20));
        for (var k = 0; k <= steps; k++) {
          var a = 2 * Math.PI * k / steps;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
      }
      function sampleArc(cx, cy, r, a1deg, a2deg) {
        var delta = (a2deg - a1deg) % 360;
        if (delta < 0) delta += 360;
        if (delta === 0) delta = 360;
        var steps = Math.max(8, Math.ceil(delta / 15));
        var pts = [];
        for (var k = 0; k <= steps; k++) {
          var a = (a1deg + delta * k / steps) * Math.PI / 180;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return pts;
      }
      function sampleEllipse(cx, cy, majX, majY, ratio, t1, t2) {
        var a = Math.hypot(majX, majY) || 1;
        var b = a * ratio;
        var ux = majX / a, uy = majY / a;
        var vx = -uy, vy = ux;
        if (t2 < t1) t2 += 2 * Math.PI;
        var span = t2 - t1;
        var steps = Math.max(16, Math.ceil(span / (10 * Math.PI / 180)));
        var pts = [];
        for (var k = 0; k <= steps; k++) {
          var t = t1 + span * k / steps;
          var ct = Math.cos(t), st = Math.sin(t);
          pts.push([cx + a * ct * ux + b * st * vx, cy + a * ct * uy + b * st * vy]);
        }
        return pts;
      }
      function bulgeArc(p1, p2, b) {
        if (!b) return [p1, p2];
        var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        var c = Math.hypot(dx, dy);
        if (c === 0) return [p1, p2];
        var theta = 4 * Math.atan(Math.abs(b));
        var R = c / (2 * Math.sin(theta / 2));
        var d = R * Math.cos(theta / 2);
        var ux = dy / c, uy = -dx / c;
        var sign = b > 0 ? 1 : -1;
        var cx = (p1[0] + p2[0]) / 2 - ux * d * sign;
        var cy = (p1[1] + p2[1]) / 2 - uy * d * sign;
        var a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
        var a2 = Math.atan2(p2[1] - cy, p2[0] - cx);
        var delta;
        if (b > 0) { delta = a2 - a1; if (delta < 0) delta += 2 * Math.PI; }
        else { delta = a1 - a2; if (delta < 0) delta += 2 * Math.PI; }
        var steps = Math.max(4, Math.ceil(delta / (12 * Math.PI / 180)));
        var pts = [];
        for (var k = 0; k <= steps; k++) {
          var ang = b > 0 ? a1 + delta * k / steps : a1 - delta * k / steps;
          pts.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]);
        }
        return pts;
      }
      function pushBulgePoly(pts, bulges, closed) {
        var sampled = [];
        var segCount = pts.length - 1 + (closed && pts.length > 2 ? 1 : 0);
        for (var q = 0; q < segCount; q++) {
          var p1 = pts[q % pts.length];
          var p2 = pts[(q + 1) % pts.length];
          var bl = q < bulges.length ? num(bulges[q]) : 0;
          var arc = bulgeArc(p1, p2, bl);
          for (var k = 0; k < arc.length; k++) {
            var last = sampled[sampled.length - 1];
            if (!last || Math.abs(last[0] - arc[k][0]) > 0.01 || Math.abs(last[1] - arc[k][1]) > 0.01) {
              sampled.push(arc[k]);
            }
          }
        }
        addPath(sampled, closed);
      }

      for (var e = 0; e < entities.length; e++) {
        var ent = entities[e];
        switch (ent.type) {
          case 'LINE': {
            var x1 = num(ent.codes[10][0]), y1 = num(ent.codes[20][0]);
            var x2 = num(ent.codes[11][0]), y2 = num(ent.codes[21][0]);
            lengthMm += Math.hypot(x2 - x1, y2 - y1) * unitFactor;
            contourCount++;
            bbox(x1 * unitFactor, y1 * unitFactor);
            bbox(x2 * unitFactor, y2 * unitFactor);
            addPath([[x1, y1], [x2, y2]], false);
            break;
          }
          case 'CIRCLE': {
            var cr = num(ent.codes[40][0]);
            var ccx = num(ent.codes[10][0]), ccy = num(ent.codes[20][0]);
            lengthMm += 2 * Math.PI * cr * unitFactor;
            contourCount++;
            bbox((ccx - cr) * unitFactor, (ccy - cr) * unitFactor);
            bbox((ccx + cr) * unitFactor, (ccy + cr) * unitFactor);
            addPath(sampleCircle(ccx, ccy, cr), true);
            break;
          }
          case 'ARC': {
            var ar = num(ent.codes[40][0]);
            var a1 = num(ent.codes[50][0]), a2 = num(ent.codes[51][0]);
            var delta = (a2 - a1) % 360;
            if (delta < 0) delta += 360;
            if (delta === 0) delta = 360;
            lengthMm += ar * (delta * Math.PI / 180) * unitFactor;
            contourCount++;
            var acx = num(ent.codes[10][0]), acy = num(ent.codes[20][0]);
            bbox((acx - ar) * unitFactor, (acy - ar) * unitFactor);
            bbox((acx + ar) * unitFactor, (acy + ar) * unitFactor);
            addPath(sampleArc(acx, acy, ar, a1, a2), false);
            break;
          }
          case 'LWPOLYLINE': {
            var xs = ent.codes[10] || [], ys = ent.codes[20] || [];
            var pts = [];
            var n = Math.min(xs.length, ys.length);
            for (var pi = 0; pi < n; pi++) pts.push([num(xs[pi]), num(ys[pi])]);
            var lwClosed = (num(ent.codes[70] ? ent.codes[70][0] : 0) & 1) !== 0;
            lengthMm += lwLen(pts, ent.codes[42] || [], lwClosed, unitFactor);
            contourCount++;
            for (var pb = 0; pb < pts.length; pb++) bbox(pts[pb][0] * unitFactor, pts[pb][1] * unitFactor);
            pushBulgePoly(pts, ent.codes[42] || [], lwClosed);
            break;
          }
          case 'POLYLINE': {
            var ppts = [];
            var pClosed = (num(ent.codes[70] ? ent.codes[70][0] : 0) & 1) !== 0;
            var v = e + 1;
            while (v < entities.length && entities[v].type === 'VERTEX') {
              ppts.push([num(entities[v].codes[10][0]), num(entities[v].codes[20][0])]);
              v++;
            }
            lengthMm += polyLen(ppts, pClosed, unitFactor);
            contourCount++;
            for (var qb = 0; qb < ppts.length; qb++) bbox(ppts[qb][0] * unitFactor, ppts[qb][1] * unitFactor);
            addPath(ppts, pClosed);
            e = v;
            break;
          }
          case 'SPLINE': {
            var spts = [];
            var fx = ent.codes[11] || [], fy = ent.codes[21] || [];
            var cx = ent.codes[10] || [], cy = ent.codes[20] || [];
            if (fx.length >= 2 && fy.length >= 2) {
              var sn = Math.min(fx.length, fy.length);
              for (var si = 0; si < sn; si++) spts.push([num(fx[si]), num(fy[si])]);
              lengthMm += polyLen(spts, false, unitFactor);
            } else if (cx.length >= 2 && cy.length >= 2) {
              var sn2 = Math.min(cx.length, cy.length);
              for (var sj = 0; sj < sn2; sj++) spts.push([num(cx[sj]), num(cy[sj])]);
              lengthMm += polyLen(spts, false, unitFactor) * 0.95;
            }
            contourCount++;
            for (var sb = 0; sb < spts.length; sb++) bbox(spts[sb][0] * unitFactor, spts[sb][1] * unitFactor);
            addPath(spts, false);
            break;
          }
          case 'ELLIPSE': {
            var ecx = num(ent.codes[10][0]), ecy = num(ent.codes[20][0]);
            var majX = num(ent.codes[11][0]), majY = num(ent.codes[21][0]);
            var ratio = ent.codes[40] ? num(ent.codes[40][0]) : 1;
            var a = Math.hypot(majX, majY);
            var b = a * ratio;
            var hh = Math.pow((a - b) / (a + b), 2);
            var perim = Math.PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
            var t1 = ent.codes[41] ? num(ent.codes[41][0]) : 0;
            var t2 = ent.codes[42] ? num(ent.codes[42][0]) : 2 * Math.PI;
            var frac = Math.min(1, Math.abs(t2 - t1) / (2 * Math.PI));
            lengthMm += perim * frac * unitFactor;
            contourCount++;
            bbox((ecx - a) * unitFactor, (ecy - a) * unitFactor);
            bbox((ecx + a) * unitFactor, (ecy + a) * unitFactor);
            addPath(sampleEllipse(ecx, ecy, majX, majY, ratio, t1, t2), frac >= 0.999);
            break;
          }
          case 'POINT':
          case 'TEXT':
          case 'MTEXT':
          case 'DIMENSION':
          case 'HATCH':
            skipped++;
            break;
          case 'INSERT':
            hasBlocks = true;
            break;
        }
      }

      return {
        kind: 'dxf',
        lengthMm: lengthMm,
        bbox: { x: isFinite(minX) ? Math.max(0, maxX - minX) : 0, y: isFinite(minY) ? Math.max(0, maxY - minY) : 0 },
        bounds: { minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0, maxX: isFinite(maxX) ? maxX : 0, maxY: isFinite(maxY) ? maxY : 0 },
        contourCount: contourCount,
        skipped: skipped,
        hasBlocks: hasBlocks,
        unitFactor: unitFactor,
        paths: paths
      };
    }

    /* ----- STL parsētājs ----- */
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

    function makeStlAcc() {
      return { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, volume: 0, area: 0, upArea: 0 };
    }
    function accTri(acc, v1, v2, v3) {
      var vs = [v1, v2, v3];
      for (var i = 0; i < 3; i++) {
        var x = vs[i][0], y = vs[i][1], z = vs[i][2];
        if (x < acc.minX) acc.minX = x; if (x > acc.maxX) acc.maxX = x;
        if (y < acc.minY) acc.minY = y; if (y > acc.maxY) acc.maxY = y;
        if (z < acc.minZ) acc.minZ = z; if (z > acc.maxZ) acc.maxZ = z;
      }
      var cr = cross(sub(v2, v1), sub(v3, v1));
      acc.volume += dot(v1, cr) / 6;
      var areaTri = Math.sqrt(dot(cr, cr)) / 2;
      acc.area += areaTri;
      if (cr[2] > 0) acc.upArea += areaTri;
    }
    function finalizeStl(acc, triangles, verts) {
      return {
        kind: 'stl',
        bbox: { x: acc.maxX - acc.minX, y: acc.maxY - acc.minY, z: acc.maxZ - acc.minZ },
        center: { x: (acc.minX + acc.maxX) / 2, y: (acc.minY + acc.maxY) / 2, z: (acc.minZ + acc.maxZ) / 2 },
        volumeMm3: Math.abs(acc.volume),
        areaMm2: acc.area,
        upAreaMm2: acc.upArea,
        triangles: triangles,
        verts: verts
      };
    }

    function parseBinaryStl(buffer) {
      return new Promise(function (resolve) {
        var dv = new DataView(buffer);
        var n = dv.getUint32(80, true);
        var acc = makeStlAcc();
        var verts = new Float32Array(n * 9);
        var CHUNK = 60000;
        var i = 0;
        function step() {
          var end = Math.min(i + CHUNK, n);
          for (; i < end; i++) {
            var base = 84 + i * 50 + 12;
            var v1 = [dv.getFloat32(base, true), dv.getFloat32(base + 4, true), dv.getFloat32(base + 8, true)];
            var v2 = [dv.getFloat32(base + 12, true), dv.getFloat32(base + 16, true), dv.getFloat32(base + 20, true)];
            var v3 = [dv.getFloat32(base + 24, true), dv.getFloat32(base + 28, true), dv.getFloat32(base + 32, true)];
            accTri(acc, v1, v2, v3);
            var vb = i * 9;
            verts[vb] = v1[0]; verts[vb + 1] = v1[1]; verts[vb + 2] = v1[2];
            verts[vb + 3] = v2[0]; verts[vb + 4] = v2[1]; verts[vb + 5] = v2[2];
            verts[vb + 6] = v3[0]; verts[vb + 7] = v3[1]; verts[vb + 8] = v3[2];
          }
          if (i < n) {
            setTimeout(step, 0);
          } else {
            resolve(finalizeStl(acc, n, verts));
          }
        }
        if (n === 0) { resolve(finalizeStl(acc, 0, verts)); return; }
        setTimeout(step, 0);
      });
    }

    function parseAsciiStl(text) {
      return new Promise(function (resolve) {
        var re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
        var acc = makeStlAcc();
        var tri = [];
        var arr = [];
        var count = 0;
        var CHUNK = 60000;
        function step() {
          var processed = 0;
          var m;
          while (processed < CHUNK && (m = re.exec(text)) !== null) {
            tri.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
            if (tri.length === 3) {
              accTri(acc, tri[0], tri[1], tri[2]);
              arr.push(tri[0][0], tri[0][1], tri[0][2], tri[1][0], tri[1][1], tri[1][2], tri[2][0], tri[2][1], tri[2][2]);
              tri = [];
              count++;
              processed++;
            }
          }
          if (m === null) {
            resolve(finalizeStl(acc, count, new Float32Array(arr)));
          } else {
            setTimeout(step, 0);
          }
        }
        setTimeout(step, 0);
      });
    }

    /* ----- STEP parsētājs ----- */
    function parseStep(text) {
      var re = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)/g;
      var m;
      var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      var count = 0;
      while ((m = re.exec(text)) !== null) {
        var x = parseFloat(m[1]), y = parseFloat(m[2]), z = parseFloat(m[3]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        count++;
      }
      if (count < 8) {
        throw new Error('Neizdevās nolasīt ģeometriju no STEP faila.');
      }
      return { kind: 'step', bbox: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }, pointCount: count };
    }

    /* ----- Aprēķinu dzinējs ----- */
    function compute(geom, material, quantity, ownMaterial, removal) {
      var mat = MATERIALS[material];
      var X = geom.bbox.x, Y = geom.bbox.y, Z = geom.bbox.z;
      var warnings = [];

      if (X > CONFIG.maxBedX || Y > CONFIG.maxBedY) {
        warnings.push('Detaļa pārsniedz darba lauku 2500 × 1300 mm. Sazinieties ar mums par sadalīšanu.');
      }
      if (Z > CONFIG.maxZ) {
        warnings.push('Biezums pārsniedz mūsu Z gājienu. Nepieciešama atsevišķa saskaņošana.');
      }
      if (material === 'aluminum' && Z > 20) {
        warnings.push('Biezam alumīnijam cena var būtiski atšķirties.');
      }

      var passes = null;
      var machineMin;

      if (geom.kind === 'dxf' || geom.kind === 'manual2d') {
        passes = Math.max(1, Math.ceil(Z / mat.ap));
        var cutTime = (geom.lengthMm + geom.contourCount * CONFIG.leadInMm) * passes / mat.feed;
        var plungeTime = geom.contourCount * passes * (Z / passes) / CONFIG.plungeFeed;
        var rapidTime = geom.contourCount * passes * 300 / CONFIG.rapidFeed;
        machineMin = (cutTime + plungeTime + rapidTime) / CONFIG.efficiency;
      } else {
        var margin = CONFIG.stockMarginMm;
        var stockVol = (X + 2 * margin) * (Y + 2 * margin) * Z;
        var partVolume;
        if (geom.kind === 'stl') {
          partVolume = geom.volumeMm3;
        } else {
          partVolume = (X * Y * Z) * (1 - removal);
        }
        var removalVol = Math.max(stockVol - partVolume, 0) / 1000;
        var roughMin = removalVol / mat.mrr / CONFIG.efficiency;
        var slopeFactor;
        if (geom.kind === 'stl') {
          slopeFactor = clamp(geom.upAreaMm2 / (X * Y), 1, 3);
        } else {
          slopeFactor = 1.6;
        }
        var finishLen = (X * Y) / mat.stepover * slopeFactor;
        var finishMin = finishLen / mat.finishFeed / CONFIG.efficiency;
        machineMin = roughMin + finishMin;
      }

      var machineCost = machineMin / 60 * CONFIG.hourlyRate;
      var toolingCost = machineCost * CONFIG.toolingRate * mat.toolFactor;
      var materialCost = 0;
      if (!ownMaterial) {
        var m2 = CONFIG.stockMarginMm;
        materialCost = ((X + 2 * m2) / 1000) * ((Y + 2 * m2) / 1000) * Z * mat.eurPerM2Mm;
      }
      var unitCost = machineCost + toolingCost + materialCost;
      var setupCost = CONFIG.setupMinutes / 60 * CONFIG.hourlyRate;
      var discount = qtyDiscount(quantity);
      var subtotal = unitCost * quantity * discount + setupCost;
      var total = roundUp50(Math.max(subtotal * (1 + CONFIG.marginRate), CONFIG.minOrderEur));
      var unitPrice = total / quantity;

      return {
        passes: passes,
        machineMin: machineMin,
        machineTotalMin: machineMin * quantity,
        machineCost: machineCost,
        toolingCost: toolingCost,
        materialCost: materialCost,
        setupCost: setupCost,
        total: total,
        unitPrice: unitPrice,
        discount: discount,
        warnings: warnings
      };
    }

    function confidenceFor(kind) {
      if (kind === 'dxf') return { level: 'augsta', label: 'Augsta', note: 'Kontūras nolasītas no DXF faila — cena balstīta uz reālo griezuma garumu.' };
      if (kind === 'stl') return { level: 'videja', label: 'Vidēja', note: 'Modelis nolasīts no STL — tilpums ir precīzs, bet instrumenta ceļš ir novērtējums.' };
      if (kind === 'step') return { level: 'zema', label: 'Zema', note: 'No STEP faila nolasām tikai gabarītus, tāpēc tāme ir aptuvena.' };
      return { level: 'zema', label: 'Zema', note: 'Izmēri ievadīti manuāli — tāme balstīta uz aptuveniem parametriem.' };
    }

    /* ----- Vizualizācija ----- */
    function makeViewer(drawFn) {
      var canvas = document.createElement('canvas');
      canvas.className = 'calc__preview-canvas';
      canvas.width = 640;
      canvas.height = 400;
      var ctx = canvas.getContext('2d');
      var view = { rx: -0.55, ry: 0.75, scale: 1, panX: 0, panY: 0 };
      var pointers = new Map();
      var scheduled = false;

      function redraw() {
        scheduled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#182120';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawFn(ctx, view, canvas);
      }
      function requestRedraw() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(redraw);
      }

      canvas.addEventListener('pointerdown', function (e) {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      });
      canvas.addEventListener('pointermove', function (e) {
        var p = pointers.get(e.pointerId);
        if (!p) return;
        var ids = Array.from(pointers.keys());
        if (ids.length === 2) {
          var otherId = ids[0] === e.pointerId ? ids[1] : ids[0];
          var other = pointers.get(otherId);
          var oldDist = Math.hypot(p.x - other.x, p.y - other.y);
          var newDist = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          if (oldDist > 1) {
            view.scale = Math.max(0.2, Math.min(24, view.scale * (newDist / oldDist)));
          }
          view.panX += ((e.clientX + other.x) - (p.x + other.x)) / 2;
          view.panY += ((e.clientY + other.y) - (p.y + other.y)) / 2;
        } else {
          var dx = e.clientX - p.x, dy = e.clientY - p.y;
          if (e.buttons & 4 || e.buttons & 2 || e.shiftKey) {
            view.panX += dx;
            view.panY += dy;
          } else {
            view.ry += dx * 0.01;
            view.rx += dy * 0.01;
            if (view.rx > 1.45) view.rx = 1.45;
            if (view.rx < -1.45) view.rx = -1.45;
          }
        }
        p.x = e.clientX;
        p.y = e.clientY;
        requestRedraw();
      });
      function end(e) { pointers.delete(e.pointerId); }
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        view.scale = Math.max(0.2, Math.min(24, view.scale * Math.exp(-e.deltaY * 0.0012)));
        requestRedraw();
      }, { passive: false });
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      redraw();
      return canvas;
    }

    function buildSolidViewer(verts, triCount, bbox, center) {
      var MAX_TRIS = 9000;
      var drawnCount = Math.min(triCount, MAX_TRIS);
      var stride = Math.max(1, Math.floor(triCount / drawnCount));

      var norms = new Float32Array(drawnCount * 3);
      var i, k;
      for (i = 0, k = 0; i < drawnCount; i++, k += 3) {
        var vi = i * stride * 9;
        var ax = verts[vi + 3] - verts[vi], ay = verts[vi + 4] - verts[vi + 1], az = verts[vi + 5] - verts[vi + 2];
        var bx = verts[vi + 6] - verts[vi], by = verts[vi + 7] - verts[vi + 1], bz = verts[vi + 8] - verts[vi + 2];
        var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        norms[k] = nx / len; norms[k + 1] = ny / len; norms[k + 2] = nz / len;
      }

      var cx = center ? center.x : bbox.x / 2;
      var cy = center ? center.y : bbox.y / 2;
      var cz = center ? center.z : bbox.z / 2;
      var maxDim = Math.max(bbox.x, bbox.y, bbox.z, 1);
      var Lx = 0.35, Ly = 0.55, Lz = 0.75;
      var Ll = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
      Lx /= Ll; Ly /= Ll; Lz /= Ll;

      return makeViewer(function (ctx, view, canvas) {
        var scale = view.scale * Math.min(canvas.width, canvas.height) / maxDim * 0.95;
        var ox = canvas.width / 2 + view.panX;
        var oy = canvas.height / 2 + view.panY;
        var cosX = Math.cos(view.rx), sinX = Math.sin(view.rx);
        var cosY = Math.cos(view.ry), sinY = Math.sin(view.ry);

        var tris = [];
        for (var t = 0; t < drawnCount; t++) {
          var base = t * stride * 9;
          var depth = 0;
          var pts = new Float32Array(6);
          var inside = false;
          for (var v = 0; v < 3; v++) {
            var px = verts[base + v * 3] - cx;
            var py = verts[base + v * 3 + 1] - cy;
            var pz = verts[base + v * 3 + 2] - cz;
            var y1 = py * cosX - pz * sinX;
            var z1 = py * sinX + pz * cosX;
            var x2 = px * cosY + z1 * sinY;
            var z2 = -px * sinY + z1 * cosY;
            var sx = ox + x2 * scale;
            var sy = oy - y1 * scale;
            pts[v * 2] = sx; pts[v * 2 + 1] = sy;
            depth += z2;
            if (sx >= 0 && sx <= canvas.width && sy >= 0 && sy <= canvas.height) inside = true;
          }
          if (!inside) continue;
          depth /= 3;
          var nk = t * 3;
          var nY1 = norms[nk + 1] * cosX - norms[nk + 2] * sinX;
          var nZ1 = norms[nk + 1] * sinX + norms[nk + 2] * cosX;
          var nX2 = norms[nk] * cosY + nZ1 * sinY;
          var nZ2 = -norms[nk] * sinY + nZ1 * cosY;
          var lambert = Math.abs(nX2 * Lx + nY1 * Ly + nZ2 * Lz);
          var sh = 0.26 + 0.74 * lambert;
          tris.push({ d: depth, pts: pts, c: 'rgb(' + Math.round(203 * sh) + ',' + Math.round(205 * sh) + ',' + Math.round(204 * sh) + ')' });
        }
        tris.sort(function (a, b) { return b.d - a.d; });
        for (var j = 0; j < tris.length; j++) {
          var tr = tris[j];
          ctx.fillStyle = tr.c;
          ctx.strokeStyle = tr.c;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(tr.pts[0], tr.pts[1]);
          ctx.lineTo(tr.pts[2], tr.pts[3]);
          ctx.lineTo(tr.pts[4], tr.pts[5]);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      });
    }

    function makeBoxVerts(bbox) {
      var x = bbox.x, y = bbox.y, z = bbox.z;
      var c = [
        [0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0],
        [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]
      ];
      var tris = [
        [0, 2, 1], [0, 3, 2],
        [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4],
        [3, 6, 2], [3, 7, 6],
        [0, 4, 7], [0, 7, 3],
        [1, 2, 6], [1, 6, 5]
      ];
      var arr = new Float32Array(tris.length * 9);
      for (var i = 0; i < tris.length; i++) {
        for (var v = 0; v < 3; v++) {
          var p = c[tris[i][v]];
          arr[i * 9 + v * 3] = p[0];
          arr[i * 9 + v * 3 + 1] = p[1];
          arr[i * 9 + v * 3 + 2] = p[2];
        }
      }
      return arr;
    }

    function renderDxfPreview(parsed) {
      var b = parsed.bounds || { minX: 0, minY: 0, maxX: parsed.bbox.x || 0, maxY: parsed.bbox.y || 0 };
      var w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1);
      var pad = Math.max(w, h) * 0.06 + 2;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'calc__preview-svg');
      svg.setAttribute('viewBox', (b.minX - pad) + ' ' + (-b.maxY - pad) + ' ' + (w + 2 * pad) + ' ' + (h + 2 * pad));
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'DXF kontūru skats no augšas');
      var paths = parsed.paths || [];
      for (var i = 0; i < paths.length; i++) {
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[i]);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
      }
      previewEl.appendChild(svg);
    }

    function renderStlPreview(parsed) {
      var canvas = buildSolidViewer(parsed.verts, parsed.triangles || 0, parsed.bbox, parsed.center);
      previewEl.appendChild(canvas);
    }

    function renderStepPreview(parsed) {
      var canvas = buildSolidViewer(makeBoxVerts(parsed.bbox), 12, parsed.bbox);
      previewEl.appendChild(canvas);
    }

    function renderPreview(file) {
      previewEl.innerHTML = '';
      previewEl.hidden = false;
      var parsed = file.parsed;
      if (parsed.kind === 'dxf') {
        renderDxfPreview(parsed);
      } else {
        if (parsed.kind === 'stl') renderStlPreview(parsed);
        else renderStepPreview(parsed);
        var hint = document.createElement('span');
        hint.className = 'calc__preview-hint';
        hint.textContent = 'Velc, lai grieztu · ritentiņš tuvina · Shift + velc pārvieto';
        previewEl.appendChild(hint);
      }
    }

    /* ----- UI ----- */
    var fileTab = document.getElementById('tab-file');
    var manualTab = document.getElementById('tab-manual');
    var panelFile = document.getElementById('panel-file');
    var panelManual = document.getElementById('panel-manual');
    var fileInput = document.getElementById('calc-file');
    var dropzone = document.getElementById('calc-dropzone');
    var filecard = document.getElementById('calc-filecard');
    var fileNameEl = document.getElementById('calc-file-name');
    var fileMetaEl = document.getElementById('calc-file-meta');
    var fileGeoEl = document.getElementById('calc-file-geo');
    var previewEl = document.getElementById('calc-preview');
    var fileRemove = document.getElementById('calc-file-remove');
    var thicknessField = document.getElementById('calc-thickness-field');
    var thicknessEl = document.getElementById('calc-thickness');
    var thicknessHint = document.getElementById('calc-thickness-hint');
    var thicknessError = document.getElementById('calc-thickness-error');
    var materialEl = document.getElementById('calc-material');
    var quantityEl = document.getElementById('calc-quantity');
    var ownMaterialEl = document.getElementById('calc-own-material');
    var unitsField = document.getElementById('calc-units-field');
    var unitsEl = document.getElementById('calc-units');
    var removalField = document.getElementById('calc-removal-field');
    var removalEl = document.getElementById('calc-removal');
    var removalValue = document.getElementById('calc-removal-value');
    var lengthEl = document.getElementById('calc-length');
    var widthEl = document.getElementById('calc-width');

    var priceEl = document.getElementById('calc-price');
    var hintEl = document.getElementById('calc-hint');
    var breakdownEl = document.getElementById('calc-breakdown');
    var confidenceEl = document.getElementById('calc-confidence');
    var confidenceNoteEl = document.getElementById('calc-confidence-note');
    var unitEl = document.getElementById('calc-unit');
    var machinePerUnitEl = document.getElementById('calc-machine-per-unit');
    var machineTotalEl = document.getElementById('calc-machine-total');
    var passesEl = document.getElementById('calc-passes');
    var materialCostEl = document.getElementById('calc-material-cost');
    var setupEl = document.getElementById('calc-setup');
    var warningEl = document.getElementById('calc-warning');
    var submitBtn = document.getElementById('calc-submit');
    var contactEl = document.getElementById('calc-contact');
    var contactForm = document.getElementById('calc-contact-form');
    var contactName = document.getElementById('calc-contact-name');
    var contactEmail = document.getElementById('calc-contact-email');
    var contactPhone = document.getElementById('calc-contact-phone');
    var contactNotes = document.getElementById('calc-contact-notes');
    var contactStatus = document.getElementById('calc-contact-status');
    var mailtoNote = document.getElementById('calc-mailto-note');

    var state = { mode: 'file', file: null, fileError: null };
    var lastSummary = '';
    var lastGeometry = null;
    var lastConfidence = null;

    function setMode(mode) {
      state.mode = mode;
      fileTab.classList.toggle('is-active', mode === 'file');
      fileTab.setAttribute('aria-selected', String(mode === 'file'));
      manualTab.classList.toggle('is-active', mode === 'manual');
      manualTab.setAttribute('aria-selected', String(mode === 'manual'));
      panelFile.hidden = mode !== 'file';
      panelManual.hidden = mode !== 'manual';
      updateThicknessVisibility();
      recalculate();
    }

    function updateThicknessVisibility() {
      var isDxfOrNone = state.mode === 'manual' || !state.file || state.file.kind === 'dxf';
      thicknessField.hidden = !isDxfOrNone;
      if (state.mode === 'file' && state.file && state.file.kind === 'dxf') {
        thicknessHint.textContent = 'DXF fails nesatur biezumu — norādiet materiāla biezumu.';
      } else if (state.mode === 'file' && state.file && (state.file.kind === 'stl' || state.file.kind === 'step')) {
        thicknessHint.textContent = '';
      } else {
        thicknessHint.textContent = '';
      }
      var showRemoval = state.mode === 'file' && state.file && state.file.kind === 'step';
      removalField.hidden = !showRemoval;
      var showUnits = state.mode === 'file' && state.file && (state.file.kind === 'stl' || state.file.kind === 'step');
      unitsField.hidden = !showUnits;
    }

    function clearWarning() {
      warningEl.textContent = '';
      warningEl.classList.remove('is-visible');
    }

    function showCritical(msg) {
      clearWarning();
      if (msg) {
        warningEl.textContent = msg;
        warningEl.classList.add('is-visible');
      }
    }

    function showEmptyState() {
      priceEl.textContent = '—';
      hintEl.hidden = false;
      breakdownEl.hidden = true;
      confidenceEl.textContent = '—';
      confidenceEl.removeAttribute('data-level');
      confidenceNoteEl.textContent = '';
      submitBtn.disabled = true;
      lastSummary = '';
      lastGeometry = null;
      lastConfidence = null;
    }

    function showResult(result, geom, confidence, extraWarnings) {
      hintEl.hidden = true;
      breakdownEl.hidden = false;
      priceEl.textContent = fmtCurrency(result.total);
      unitEl.textContent = fmtCurrency(result.unitPrice);
      machinePerUnitEl.textContent = fmtMinutes(result.machineMin);
      machineTotalEl.textContent = fmtMinutes(result.machineTotalMin);
      passesEl.textContent = result.passes != null ? String(result.passes) : '—';
      materialCostEl.textContent = ownMaterialEl.checked ? 'klienta materiāls' : fmtCurrency(result.materialCost);
      setupEl.textContent = fmtCurrency(result.setupCost);

      confidenceEl.textContent = confidence.label;
      confidenceEl.setAttribute('data-level', confidence.level);
      confidenceNoteEl.textContent = confidence.note;

      var allWarnings = extraWarnings.concat(result.warnings);
      if (allWarnings.length) {
        warningEl.textContent = allWarnings.join(' ');
        warningEl.classList.add('is-visible');
      } else {
        clearWarning();
      }

      submitBtn.disabled = false;
      lastGeometry = geom;
      lastConfidence = confidence;
      lastSummary = buildSummaryText(result, confidence);
    }

    function buildSummaryText(result, confidence) {
      var lines = [];
      lines.push('CNC frēzēšanas tāme');
      lines.push('Materiāls: ' + MATERIALS[materialEl.value].label);
      if (state.file) lines.push('Fails: ' + state.file.name);
      else lines.push('Ievade: manuāla');
      var b = lastGeometry.bbox;
      lines.push('Gabarīti: ' + fmtDim(b.x) + ' × ' + fmtDim(b.y) + (b.z ? ' × ' + fmtDim(b.z) : ''));
      lines.push('Daudzums: ' + (parseInt(quantityEl.value, 10) || 1));
      lines.push('Ticamība: ' + confidence.label);
      lines.push('Cena par gabalu (bez PVN): ' + fmtCurrency(result.unitPrice));
      lines.push('Kopējā cena (bez PVN): ' + fmtCurrency(result.total));
      lines.push('Mašīnlaiks vienam gabalam: ' + fmtMinutes(result.machineMin));
      lines.push('Griešanas gājieni: ' + (result.passes != null ? result.passes : '—'));
      return lines.join('\n');
    }

    function recalculate() {
      clearWarning();
      if (state.mode === 'manual') {
        recalcManual();
      } else {
        recalcFile();
      }
    }

    function recalcFile() {
      if (state.fileError) { showCritical(state.fileError); showEmptyState(); return; }
      if (!state.file) { showEmptyState(); return; }

      var parsed = state.file.parsed;
      var material = materialEl.value;
      var quantity = parseInt(quantityEl.value, 10) || 1;
      var ownMaterial = ownMaterialEl.checked;
      var removal = (parseInt(removalEl.value, 10) || 45) / 100;
      var extraWarnings = [];
      var geom;

      if (parsed.kind === 'dxf') {
        var thickness = parseFloat(thicknessEl.value);
        if (!isFinite(thickness) || thickness <= 0) {
          thicknessError.textContent = 'Norādiet materiāla biezumu — DXF fails to nesatur.';
          thicknessError.classList.add('is-visible');
          thicknessEl.setAttribute('aria-invalid', 'true');
          showEmptyState();
          return;
        }
        thicknessError.textContent = '';
        thicknessError.classList.remove('is-visible');
        thicknessEl.setAttribute('aria-invalid', 'false');
        geom = { kind: 'dxf', lengthMm: parsed.lengthMm, contourCount: parsed.contourCount, bbox: { x: parsed.bbox.x, y: parsed.bbox.y, z: thickness } };
        if (parsed.hasBlocks) extraWarnings.push('Failā ir bloki (INSERT), kas netiek izvērsti — kontūru garums var būt novērtēts par mazu.');
        if (parsed.skipped > 0) extraWarnings.push('Izlaidām ' + parsed.skipped + ' objektus (teksts, izmēri, šrafūras), kas netiek griezti.');
      } else if (parsed.kind === 'stl') {
        var sf = unitFactor();
        geom = { kind: 'stl', bbox: { x: parsed.bbox.x * sf, y: parsed.bbox.y * sf, z: parsed.bbox.z * sf }, volumeMm3: parsed.volumeMm3 * sf * sf * sf, upAreaMm2: parsed.upAreaMm2 * sf * sf };
        if (parsed.triangles > 2000000) extraWarnings.push('Modelim ir vairāk nekā 2 miljoni trijstūru — aprēķins var aizņemt dažas sekundes.');
      } else {
        var sf2 = unitFactor();
        geom = { kind: 'step', bbox: { x: parsed.bbox.x * sf2, y: parsed.bbox.y * sf2, z: parsed.bbox.z * sf2 } };
        extraWarnings.push('No STEP faila nolasām tikai gabarītus, tāpēc tāme ir aptuvena.');
      }

      var result = compute(geom, material, quantity, ownMaterial, removal);
      showResult(result, geom, confidenceFor(parsed.kind), extraWarnings);
    }

    function recalcManual() {
      var length = parseFloat(lengthEl.value);
      var width = parseFloat(widthEl.value);
      var thickness = parseFloat(thicknessEl.value);
      var quantity = parseInt(quantityEl.value, 10) || 1;
      var checked = document.querySelector('input[name="complexity"]:checked');
      var complexity = checked ? checked.value : 'simple';

      if (!isFinite(length) || length <= 0) { setManualError(lengthEl, 'calc-length-error', 'Norādiet derīgu garumu (mm).'); showEmptyState(); return; }
      if (!isFinite(width) || width <= 0) { setManualError(widthEl, 'calc-width-error', 'Norādiet derīgu platumu (mm).'); showEmptyState(); return; }
      if (!isFinite(thickness) || thickness <= 0) { setManualError(thicknessEl, 'calc-thickness-error', 'Norādiet derīgu biezumu (mm).'); showEmptyState(); return; }
      setManualError(lengthEl, 'calc-length-error', '');
      setManualError(widthEl, 'calc-width-error', '');
      setManualError(thicknessEl, 'calc-thickness-error', '');

      var geom;
      if (complexity === 'relief3d') {
        geom = { kind: 'manual3d', bbox: { x: length, y: width, z: thickness } };
      } else if (complexity === 'complex') {
        geom = { kind: 'manual2d', lengthMm: 2 * (length + width) * 2.5, contourCount: 6, bbox: { x: length, y: width, z: thickness } };
      } else {
        geom = { kind: 'manual2d', lengthMm: 2 * (length + width), contourCount: 1, bbox: { x: length, y: width, z: thickness } };
      }

      var result = compute(geom, materialEl.value, quantity, false, 0.35);
      showResult(result, geom, confidenceFor('manual'), []);
    }

    function setManualError(input, errId, msg) {
      var err = document.getElementById(errId);
      if (err) {
        err.textContent = msg;
        err.classList.toggle('is-visible', !!msg);
      }
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    /* ----- Failu apstrāde ----- */
    function readAsText(file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(new Error('Neizdevās nolasīt failu.')); };
        r.readAsText(file);
      });
    }
    function readAsArrayBuffer(file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(new Error('Neizdevās nolasīt failu.')); };
        r.readAsArrayBuffer(file);
      });
    }

    function extOf(name) {
      var m = /\.([^.]+)$/.exec(name);
      if (!m) return null;
      var e = m[1].toLowerCase();
      if (e === 'dxf') return 'dxf';
      if (e === 'stl') return 'stl';
      if (e === 'step' || e === 'stp') return 'step';
      return null;
    }

    function setFileError(msg) {
      state.fileError = msg;
      state.file = null;
      filecard.hidden = true;
      previewEl.innerHTML = '';
      previewEl.hidden = true;
      fileInput.value = '';
      updateThicknessVisibility();
      recalculate();
    }

    function clearFile() {
      state.file = null;
      state.fileError = null;
      filecard.hidden = true;
      previewEl.innerHTML = '';
      previewEl.hidden = true;
      fileInput.value = '';
      updateThicknessVisibility();
      recalculate();
    }

    function handleFile(file) {
      if (!file) return;
      if (file.size > 30 * 1024 * 1024) {
        setFileError('Fails ir lielāks par 30 MB — samaziniet failu vai sazinieties ar mums.');
        return;
      }
      var kind = extOf(file.name);
      if (!kind) {
        setFileError('Neatbalstīts faila formāts. Atbalstīti: DXF, STL, STEP.');
        return;
      }
      parseFile(file, kind).then(function (parsed) {
        state.file = { name: file.name, size: file.size, kind: kind, parsed: parsed };
        state.fileError = null;
        unitsEl.value = '1';
        renderFileCard(file, parsed);
        renderPreview(state.file);
        updateThicknessVisibility();
        recalculate();
      }).catch(function (err) {
        setFileError(err && err.message ? err.message : 'Neizdevās apstrādāt failu — pārbaudiet, vai fails nav bojāts.');
      });
    }

    function parseFile(file, kind) {
      if (kind === 'stl') {
        return readAsArrayBuffer(file).then(function (buf) {
          var dv = new DataView(buf);
          var isBinary = buf.byteLength >= 84 && (84 + 50 * dv.getUint32(80, true)) === buf.byteLength;
          if (isBinary) return parseBinaryStl(buf);
          return readAsText(file).then(parseAsciiStl);
        }).then(function (parsed) {
          if (parsed.triangles === 0 || (parsed.bbox.x === 0 && parsed.bbox.y === 0 && parsed.bbox.z === 0)) {
            throw new Error('Neizdevās nolasīt ģeometriju no STL faila.');
          }
          return parsed;
        });
      }
      return readAsText(file).then(function (text) {
        if (kind === 'dxf') {
          var parsed = parseDxf(text);
          if (parsed.lengthMm === 0) throw new Error('Failā neatradām griežamas kontūras.');
          return parsed;
        }
        return parseStep(text); // step: throws if < 8 points
      });
    }

    function renderFileCard(file, parsed) {
      filecard.hidden = false;
      fileNameEl.textContent = file.name;
      var typeLabel = parsed.kind === 'dxf' ? 'DXF' : (parsed.kind === 'stl' ? 'STL' : 'STEP');
      fileMetaEl.textContent = fmtSize(file.size) + ' · ' + typeLabel;
      var f = unitFactor();
      if (parsed.kind === 'dxf') {
        fileGeoEl.textContent = 'Gabarīti ' + fmtDim(parsed.bbox.x) + ' × ' + fmtDim(parsed.bbox.y) + ' · ' + fmtLength(parsed.lengthMm) + ' griezuma · ' + parsed.contourCount + ' kontūras';
      } else if (parsed.kind === 'stl') {
        fileGeoEl.textContent = 'Gabarīti ' + fmtDim(parsed.bbox.x * f) + ' × ' + fmtDim(parsed.bbox.y * f) + ' × ' + fmtDim(parsed.bbox.z * f) + ' · tilpums ' + fmtVolume(parsed.volumeMm3 * f * f * f);
      } else {
        fileGeoEl.textContent = 'Gabarīti ' + fmtDim(parsed.bbox.x * f) + ' × ' + fmtDim(parsed.bbox.y * f) + ' × ' + fmtDim(parsed.bbox.z * f);
      }
    }

    /* ----- Klausītāji ----- */
    fileTab.addEventListener('click', function () { setMode('file'); });
    manualTab.addEventListener('click', function () { setMode('manual'); });
    fileTab.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { manualTab.focus(); setMode('manual'); } });
    manualTab.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { fileTab.focus(); setMode('file'); } });

    fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]); });

    ['dragover', 'dragenter'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('is-dragover'); });
    });
    dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    fileRemove.addEventListener('click', clearFile);

    [materialEl, quantityEl, thicknessEl].forEach(function (el) {
      el.addEventListener('input', recalculate);
      el.addEventListener('change', recalculate);
    });
    ownMaterialEl.addEventListener('change', recalculate);
    unitsEl.addEventListener('change', function () {
      if (state.file) renderFileCard(state.file, state.file.parsed);
      recalculate();
    });
    removalEl.addEventListener('input', function () {
      removalValue.textContent = removalEl.value + ' %';
      recalculate();
    });
    [lengthEl, widthEl].forEach(function (el) {
      el.addEventListener('input', recalculate);
    });
    document.querySelectorAll('input[name="complexity"]').forEach(function (radio) {
      radio.addEventListener('change', recalculate);
    });

    /* ----- Kontaktforma ----- */
    submitBtn.addEventListener('click', function () {
      contactEl.hidden = false;
      if (!contactNotes.value) contactNotes.value = lastSummary;
      contactEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = contactName.value.trim();
      var email = contactEmail.value.trim();
      var ok = true;

      if (!name) { setContactError(contactName, 'calc-contact-name-error', 'Norādiet savu vārdu.'); ok = false; } else setContactError(contactName, 'calc-contact-name-error', '');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setContactError(contactEmail, 'calc-contact-email-error', 'Norādiet derīgu e-pasta adresi.'); ok = false; } else setContactError(contactEmail, 'calc-contact-email-error', '');
      if (!ok) return;

      var subject = 'Cenu pieprasījums — ' + (state.file ? state.file.name : 'manuāla tāme');
      var body = lastSummary + '\n\nVārds: ' + name + '\nE-pasts: ' + email +
        (contactPhone.value.trim() ? '\nTālrunis: ' + contactPhone.value.trim() : '') +
        (contactNotes.value.trim() ? '\n\nPiezīmes:\n' + contactNotes.value.trim() : '');

      if (CONFIG.formEndpoint) {
        contactStatus.textContent = 'Nosūta…';
        var fd = new FormData();
        fd.append('name', name);
        fd.append('email', email);
        fd.append('phone', contactPhone.value.trim());
        fd.append('notes', contactNotes.value.trim());
        fd.append('_subject', subject);
        fd.append('message', body);
        fetch(CONFIG.formEndpoint, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } })
          .then(function (res) {
            if (res.ok) { contactStatus.textContent = 'Pieprasījums nosūtīts.'; }
            else { throw new Error(); }
          })
          .catch(function () { contactStatus.textContent = 'Neizdevās nosūtīt — mēģiniet vēlreiz vai rakstiet uz ' + CONFIG.contactEmail + '.'; });
      } else {
        mailtoNote.hidden = false;
        window.location.href = 'mailto:' + CONFIG.contactEmail + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        contactStatus.textContent = '';
      }
    });

    function setContactError(input, errId, msg) {
      var err = document.getElementById(errId);
      if (err) {
        err.textContent = msg;
        err.classList.toggle('is-visible', !!msg);
      }
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    /* ----- Sākuma stāvoklis ----- */
    updateThicknessVisibility();
    recalculate();
  }

  /* ======================================================================
     VECĀ MANUĀLĀ LOĢIKA (SĀKUMLAPA) — nemainīta uzvedība
     ====================================================================== */
  function initLegacyCalculator() {
    var form = document.getElementById('cenu-kalkulators');
    if (!form) return;

    var WORK_AREA = { length: 2500, width: 1300 };
    var MATERIALS = {
      wood: { label: 'Koks / MDF / Saplāksnis', rate: 25, materialCostPerM2: 15, passDepth: 5, timePerMetre: 2.5 },
      plastic: { label: 'Plastmasa / Akrils / Kompozīti', rate: 30, materialCostPerM2: 35, passDepth: 4, timePerMetre: 3 },
      aluminum: { label: 'Alumīnijs / Mīkstie metāli', rate: 45, materialCostPerM2: 90, passDepth: 2, timePerMetre: 4.5 }
    };
    var COMPLEXITY = {
      simple: { label: 'Vienkārša 2D kontūrgriešana', multiplier: 1.0 },
      complex: { label: 'Sarežģīta forma, daudz detaļu', multiplier: 1.5 },
      relief3d: { label: '3D reljefs / gravējums', multiplier: 2.2 }
    };
    var SETUP_HOURS = 0.25;
    var MIN_PRICE = 15;
    var RANGE_LOW = 0.9;
    var RANGE_HIGH = 1.15;

    function isWithinWorkArea(length, width) {
      return (length <= WORK_AREA.length && width <= WORK_AREA.width) ||
             (length <= WORK_AREA.width && width <= WORK_AREA.length);
    }

    function validate(input) {
      var errors = [];
      if (!MATERIALS[input.material]) errors.push({ field: 'material', message: 'Izvēlieties materiālu.' });
      if (!COMPLEXITY[input.complexity]) errors.push({ field: 'complexity', message: 'Izvēlieties apstrādes veidu.' });
      var thickness = Number(input.thickness);
      if (!isFinite(thickness) || thickness <= 0) errors.push({ field: 'thickness', message: 'Norādiet derīgu biezumu (mm).' });
      var length = Number(input.length);
      var width = Number(input.width);
      if (!isFinite(length) || length <= 0) errors.push({ field: 'length', message: 'Norādiet derīgu garumu (mm).' });
      if (!isFinite(width) || width <= 0) errors.push({ field: 'width', message: 'Norādiet derīgu platumu (mm).' });
      if (isFinite(length) && isFinite(width) && length > 0 && width > 0 && !isWithinWorkArea(length, width)) {
        errors.push({ field: 'size', message: 'Pārsniedz mūsu iekārtas darba lauku (1300 × 2500 mm) — sazinieties, lai apspriestu detaļas sadalīšanu vairākos elementos.' });
      }
      var quantity = Number(input.quantity);
      if (!isFinite(quantity) || quantity < 1) errors.push({ field: 'quantity', message: 'Daudzumam jābūt vismaz 1.' });
      return errors;
    }

    function calculateEstimate(input) {
      var material = MATERIALS[input.material];
      var complexity = COMPLEXITY[input.complexity];
      var thickness = Number(input.thickness);
      var length = Number(input.length);
      var width = Number(input.width);
      var quantity = Number(input.quantity);
      var l = length / 1000, w = width / 1000;
      var area = l * w;
      var perimeter = 2 * (l + w);
      var passes = Math.max(1, Math.ceil(thickness / material.passDepth));
      var cuttingMinutes = perimeter * passes * material.timePerMetre;
      var machineHours = SETUP_HOURS + (cuttingMinutes / 60);
      var laborCost = material.rate * complexity.multiplier * machineHours;
      var materialCost = area * material.materialCostPerM2;
      var unitPrice = laborCost + materialCost;
      var totalMid = unitPrice * quantity;
      var low = Math.max(MIN_PRICE, Math.round(totalMid * RANGE_LOW));
      var high = Math.max(MIN_PRICE, Math.round(totalMid * RANGE_HIGH));
      return { low: low, high: high, areaM2: area, machineHours: machineHours, passes: passes, unitPrice: unitPrice, totalMid: totalMid };
    }

    function formatPriceRange(low, high) {
      if (low === high) return low + ' €';
      return low + '–' + high + ' €';
    }

    var materialEl = document.getElementById('calc-material');
    var thicknessEl = document.getElementById('calc-thickness');
    var lengthEl = document.getElementById('calc-length');
    var widthEl = document.getElementById('calc-width');
    var quantityEl = document.getElementById('calc-quantity');
    var priceEl = document.getElementById('calc-price');
    var hintEl = document.getElementById('calc-hint');
    var breakdownEl = document.getElementById('calc-breakdown');
    var unitEl = document.getElementById('calc-unit');
    var hoursEl = document.getElementById('calc-hours');
    var passesEl = document.getElementById('calc-passes');
    var warningEl = document.getElementById('calc-warning');
    var submitBtn = document.getElementById('calc-submit');

    var fieldElements = { material: materialEl, thickness: thicknessEl, length: lengthEl, width: widthEl, quantity: quantityEl };
    var fieldErrorIds = { material: 'calc-material-error', thickness: 'calc-thickness-error', length: 'calc-length-error', width: 'calc-width-error', quantity: 'calc-quantity-error' };

    function readInputs() {
      var checked = form.querySelector('input[name="complexity"]:checked');
      return { material: materialEl.value, complexity: checked ? checked.value : '', thickness: thicknessEl.value, length: lengthEl.value, width: widthEl.value, quantity: quantityEl.value };
    }

    function clearErrors() {
      form.querySelectorAll('.field__error').forEach(function (el) { el.textContent = ''; el.classList.remove('is-visible'); });
      Object.keys(fieldElements).forEach(function (key) { var el = fieldElements[key]; if (el) el.setAttribute('aria-invalid', 'false'); });
      if (warningEl) { warningEl.textContent = ''; warningEl.classList.remove('is-visible'); }
    }

    function renderErrors(errors) {
      clearErrors();
      errors.forEach(function (err) {
        if (err.field === 'size') {
          if (warningEl) { warningEl.textContent = err.message; warningEl.classList.add('is-visible'); }
          if (lengthEl) lengthEl.setAttribute('aria-invalid', 'true');
          if (widthEl) widthEl.setAttribute('aria-invalid', 'true');
          return;
        }
        var errEl = document.getElementById(fieldErrorIds[err.field]);
        if (errEl) { errEl.textContent = err.message; errEl.classList.add('is-visible'); }
        var input = fieldElements[err.field];
        if (input) input.setAttribute('aria-invalid', 'true');
      });
    }

    function formatEuro(value) { return value.toFixed(2).replace('.', ',') + ' €'; }

    var rafId = null;
    function showEmptyState() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      priceEl.textContent = '—';
      if (hintEl) hintEl.hidden = false;
      if (breakdownEl) breakdownEl.hidden = true;
      if (unitEl) unitEl.textContent = '—';
      if (hoursEl) hoursEl.textContent = '—';
      if (passesEl) passesEl.textContent = '—';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.removeAttribute('data-summary'); }
    }

    function animatePrice(low, high) {
      if (rafId) cancelAnimationFrame(rafId);
      var duration = 500;
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min(1, (ts - start) / duration);
        var eased = 1 - Math.pow(1 - progress, 3);
        var curLow = Math.round(low * eased);
        var curHigh = Math.round(high * eased);
        priceEl.textContent = formatPriceRange(curLow, curHigh);
        if (progress < 1) rafId = requestAnimationFrame(step);
        else { priceEl.textContent = formatPriceRange(low, high); rafId = null; }
      }
      rafId = requestAnimationFrame(step);
    }

    function buildSummary(input, result) {
      var mat = MATERIALS[input.material].label;
      var cx = COMPLEXITY[input.complexity].label;
      return 'Kalkulatora tāme: ' + mat + ', ' + input.length + '×' + input.width + '×' + input.thickness + ' mm, ' + cx + ', ' + input.quantity + ' gab. → ' + formatPriceRange(result.low, result.high);
    }

    function recalculate() {
      var input = readInputs();
      var errors = validate(input);
      if (errors.length) { renderErrors(errors); showEmptyState(); return; }
      renderErrors([]);
      var result = calculateEstimate(input);
      if (hintEl) hintEl.hidden = true;
      if (breakdownEl) breakdownEl.hidden = false;
      if (unitEl) unitEl.textContent = formatEuro(result.unitPrice);
      if (hoursEl) hoursEl.textContent = result.machineHours.toFixed(2) + ' h';
      if (passesEl) passesEl.textContent = String(result.passes);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.dataset.summary = buildSummary(input, result); }
      animatePrice(result.low, result.high);
    }

    [materialEl, thicknessEl, lengthEl, widthEl, quantityEl].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', recalculate);
      el.addEventListener('change', recalculate);
    });
    form.querySelectorAll('input[name="complexity"]').forEach(function (radio) {
      radio.addEventListener('change', recalculate);
    });

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var summary = submitBtn.dataset.summary || '';
        var messageField = document.getElementById('kontakti-zinojums');
        if (messageField) {
          messageField.value = summary;
          var target = document.getElementById('kontakti');
          if (target) target.scrollIntoView({ behavior: 'smooth' });
          messageField.focus();
        } else {
          window.location.href = '/kontakti/?zinojums=' + encodeURIComponent(summary);
        }
      });
    }

    recalculate();
  }
})();
