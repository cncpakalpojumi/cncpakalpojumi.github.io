// js/cnc-textures.js — reālistiski materiāli 3D skatam
// Tekstūras zīmē pārlūkā uz <canvas>, tāpēc ārēji attēli nav vajadzīgi.
// Katram materiālam ir divi materiāli: [0] – virsma (augša/apakša), [1] – malas.
// Virsmas UV: x/TILE, y/TILE (mm). Malu UV: horizontāli/TILE, vertikāli 0..1 pa biezumu.
import * as THREE from 'three';

export const TILE_MM = 400;   // viena tekstūras flīze aptver 400 × 400 mm

/* ----- Palīgfunkcijas ----- */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function noise(ctx, w, h, amount, rand) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(c, repeatV) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = repeatV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// Koka šķiedras: viļņotas līnijas gar U asi
function grain(ctx, w, h, rand, opts) {
  const { lines, color, alphaMin, alphaMax, wave, widthMax } = opts;
  for (let i = 0; i < lines; i++) {
    const y0 = rand() * h;
    const amp = wave * (0.4 + rand());
    const freq = (1 + rand() * 3) * Math.PI * 2 / w;
    const phase = rand() * Math.PI * 2;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alphaMin + rand() * (alphaMax - alphaMin);
    ctx.lineWidth = 0.6 + rand() * widthMax;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1) * amp * 0.25;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function solid(color, w = 512, h = 512, noiseAmt = 10, seed = 1) {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  noise(ctx, w, h, noiseAmt, rng(seed));
  return c;
}

/* ----- Tekstūras pa materiāliem ----- */
const draw = {
  mdfTop() {
    const c = solid('#b98f63', 1024, 1024, 18, 11);
    const ctx = c.getContext('2d');
    const r = rng(12);
    // smalkas šķiedru pārslas
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(120,80,45,0.10)' : 'rgba(225,190,150,0.10)';
      ctx.fillRect(r() * 1024, r() * 1024, 1 + r() * 3, 1);
    }
    return c;
  },
  mdfSide() {
    const c = solid('#9b7247', 1024, 256, 26, 13);
    const ctx = c.getContext('2d');
    // malas ir blīvākas pie virsmām
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(70,45,25,0.35)'); g.addColorStop(0.12, 'rgba(70,45,25,0)');
    g.addColorStop(0.88, 'rgba(70,45,25,0)'); g.addColorStop(1, 'rgba(70,45,25,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 256);
    return c;
  },
  birchTop() {
    const [c, ctx] = canvas(1024, 1024);
    const r = rng(21);
    ctx.fillStyle = '#e6cfa6'; ctx.fillRect(0, 0, 1024, 1024);
    // plati, maigi toņu viļņi
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(205,165,115,0.18)' : 'rgba(245,225,190,0.25)';
      ctx.fillRect(0, r() * 1024, 1024, 20 + r() * 90);
    }
    grain(ctx, 1024, 1024, r, { lines: 260, color: '#b48a5a', alphaMin: 0.05, alphaMax: 0.22, wave: 6, widthMax: 1.4 });
    // bērzam raksturīgie mazie zariņi
    for (let i = 0; i < 6; i++) {
      const x = r() * 1024, y = r() * 1024;
      ctx.fillStyle = 'rgba(120,85,50,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y, 3 + r() * 5, 1.5 + r() * 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    noise(ctx, 1024, 1024, 10, r);
    return c;
  },
  plywoodSide(layers) {
    const [c, ctx] = canvas(1024, 256);
    const r = rng(31 + layers);
    const h = 256 / layers;
    for (let i = 0; i < layers; i++) {
      // šķērsslāņi (gala šķiedra) ir tumšāki, garenslāņi – gaišāki
      ctx.fillStyle = i % 2 ? '#c99f6b' : '#e1c597';
      ctx.fillRect(0, i * h, 1024, h + 1);
      ctx.fillStyle = 'rgba(95,65,35,0.55)';
      ctx.fillRect(0, i * h, 1024, Math.max(1, h * 0.06));   // līmes šuve
    }
    noise(ctx, 1024, 256, 22, r);
    return c;
  },
  pineTop() {
    const [c, ctx] = canvas(1024, 1024);
    const r = rng(41);
    // līmētās lameles 30–60 mm platumā gar garumu
    let y = 0;
    while (y < 1024) {
      const hh = 75 + r() * 80;
      const tone = 200 + Math.floor(r() * 30);
      ctx.fillStyle = 'rgb(' + (tone + 20) + ',' + (tone - 15) + ',' + (tone - 75) + ')';
      ctx.fillRect(0, y, 1024, hh);
      ctx.fillStyle = 'rgba(120,80,40,0.35)';
      ctx.fillRect(0, y, 1024, 1);
      y += hh;
    }
    grain(ctx, 1024, 1024, r, { lines: 220, color: '#a8723d', alphaMin: 0.08, alphaMax: 0.35, wave: 10, widthMax: 2 });
    for (let i = 0; i < 5; i++) {
      const x = r() * 1024, yy = r() * 1024, rr = 6 + r() * 10;
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, rr);
      g.addColorStop(0, 'rgba(90,50,20,0.85)'); g.addColorStop(1, 'rgba(150,95,45,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, yy, rr * 1.6, rr, 0, 0, Math.PI * 2); ctx.fill();
    }
    noise(ctx, 1024, 1024, 10, r);
    return c;
  },
  pineSide() {
    const c = solid('#d2a46c', 1024, 256, 16, 43);
    const ctx = c.getContext('2d');
    grain(ctx, 1024, 256, rng(44), { lines: 70, color: '#9c6a36', alphaMin: 0.1, alphaMax: 0.35, wave: 3, widthMax: 1.5 });
    return c;
  },
  brushed(base, seed) {
    const [c, ctx] = canvas(1024, 1024);
    const r = rng(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2600; i++) {
      const v = r() > 0.5 ? 255 : 0;
      ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.008 + r() * 0.025) + ')';
      ctx.fillRect(0, r() * 1024, 1024, 0.5 + r() * 1.5);
    }
    return c;
  },
  acpSide() {
    // 0,3 mm alumīnijs – melns polietilēna serdenis – 0,3 mm alumīnijs (3 mm panelim)
    const [c, ctx] = canvas(512, 256);
    ctx.fillStyle = '#26282a'; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#c9cdd0';
    ctx.fillRect(0, 0, 512, 26); ctx.fillRect(0, 230, 512, 26);
    noise(ctx, 512, 256, 14, rng(51));
    return c;
  }
};

/* ----- Materiāli ----- */
const cache = new Map();

function stdMat(opts) {
  return new THREE.MeshStandardMaterial(Object.assign({ side: THREE.DoubleSide }, opts));
}

function build(materialId, group, thickness) {
  switch (group) {
    case 'mdf':
      return [
        stdMat({ map: toTexture(draw.mdfTop(), true), roughness: 0.85, metalness: 0 }),
        stdMat({ map: toTexture(draw.mdfSide(), false), roughness: 0.95, metalness: 0 })
      ];
    case 'plywood': {
      let layers = Math.max(3, Math.round(thickness / 1.45));
      if (layers % 2 === 0) layers += 1;   // saplāksnim slāņu skaits ir nepāra
      return [
        stdMat({ map: toTexture(draw.birchTop(), true), roughness: 0.7, metalness: 0 }),
        stdMat({ map: toTexture(draw.plywoodSide(layers), false), roughness: 0.9, metalness: 0 })
      ];
    }
    case 'wood':
      return [
        stdMat({ map: toTexture(draw.pineTop(), true), roughness: 0.65, metalness: 0 }),
        stdMat({ map: toTexture(draw.pineSide(), false), roughness: 0.9, metalness: 0 })
      ];
    case 'acrylic': {
      const glass = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, ior: 1.49,
        thickness: Math.max(1, thickness), attenuationColor: new THREE.Color(0xbfe8dc), attenuationDistance: 60,
        clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, side: THREE.DoubleSide
      });
      // Akrila malas pēc frēzēšanas ir matētas un zaļganas
      const edge = new THREE.MeshPhysicalMaterial({
        color: 0xd9efe8, metalness: 0, roughness: 0.45, transmission: 0.6, ior: 1.49,
        thickness: 10, attenuationColor: new THREE.Color(0x8fd3bf), attenuationDistance: 20, transparent: true, side: THREE.DoubleSide
      });
      return [glass, edge];
    }
    case 'pvc':
      return [
        stdMat({ map: toTexture(solid('#f3f3ef', 256, 256, 6, 61), true), roughness: 0.9, metalness: 0 }),
        stdMat({ map: toTexture(solid('#e9e9e4', 256, 256, 22, 62), false), roughness: 1, metalness: 0 })
      ];
    case 'hdpe':
      return [
        new THREE.MeshPhysicalMaterial({ map: toTexture(solid('#ecebe3', 256, 256, 6, 71), true), roughness: 0.55, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide }),
        stdMat({ map: toTexture(solid('#e2e0d6', 256, 256, 14, 72), false), roughness: 0.75, metalness: 0 })
      ];
    case 'acp':
      return [
        stdMat({ map: toTexture(draw.brushed('#c7cbcf', 81), true), roughness: 0.32, metalness: 0.85 }),
        stdMat({ map: toTexture(draw.acpSide(), false), roughness: 0.6, metalness: 0.2 })
      ];
    case 'aluminum':
    default:
      return [
        stdMat({ map: toTexture(draw.brushed('#d4d8dc', 91), true), roughness: 0.38, metalness: 0.9 }),
        stdMat({ map: toTexture(draw.brushed('#b5b9bd', 92), true), roughness: 0.45, metalness: 1 })
      ];
  }
}

export function getPartMaterials(materialId, group, thickness) {
  // Saplākšņa slāņi atkarīgi no biezuma; citiem pietiek ar materiālu
  const key = group === 'plywood' ? materialId + ':' + Math.round(thickness) : materialId;
  if (!cache.has(key)) cache.set(key, build(materialId, group, thickness));
  return cache.get(key);
}

/* ----- Ģeometrija ar UV un grupām ----- */
// Sadala trijstūrus virsmā (|nz| liels) un malās, piešķir UV milimetros.
export function texturedGeometry(srcGeometry, zMin, thickness) {
  const g = srcGeometry.index ? srcGeometry.toNonIndexed() : srcGeometry;
  const pos = g.attributes.position.array;
  const cap = [], capUv = [], side = [], sideUv = [];
  const t = Math.max(0.1, thickness);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const tri = [ax, ay, az, bx, by, bz, cx, cy, cz];
    if (Math.abs(nz) > 0.6) {
      cap.push(...tri);
      for (let k = 0; k < 9; k += 3) capUv.push(tri[k] / TILE_MM, tri[k + 1] / TILE_MM);
    } else {
      side.push(...tri);
      const useY = Math.abs(nx) > Math.abs(ny);
      for (let k = 0; k < 9; k += 3) {
        sideUv.push((useY ? tri[k + 1] : tri[k]) / TILE_MM, Math.min(1, Math.max(0, (tri[k + 2] - zMin) / t)));
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(cap.concat(side), 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(capUv.concat(sideUv), 2));
  out.addGroup(0, cap.length / 3, 0);
  out.addGroup(cap.length / 3, side.length / 3, 1);
  return out;
}
