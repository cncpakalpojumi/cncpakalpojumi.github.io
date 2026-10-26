// js/cnc-calculator.js — CNC frēzēšanas cenu kalkulators (/kalkulators/)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { parseDxf, orientTriangles, thinnestAxis, analyzeMesh, readStepTriangles } from './cnc-geometry.js';
import { MACHINE, PRICING, GROUPS, MATERIALS, DEFAULT_MATERIAL, DEFAULT_THICKNESS } from './cnc-materials.js';

/* ======================================================================
   Aprēķins
   ====================================================================== */
function findMaterial(id) { return MATERIALS.find((m) => m.id === id) || MATERIALS[0]; }

function priceForThickness(mat, t) {
  const exact = mat.sheets.find((s) => s.t === t);
  if (exact) return exact.eurM2;
  // Biezums nav katalogā — proporcionāli tuvākajai loksnei
  const near = mat.sheets.reduce((a, s) => (Math.abs(s.t - t) < Math.abs(a.t - t) ? s : a), mat.sheets[0]);
  return near.eurM2 * t / near.t;
}

function fitsWorkArea(x, y) {
  const a = Math.max(x, y), b = Math.min(x, y);
  return a <= MACHINE.bedX && b <= MACHINE.bedY;
}

// Mašīnlaiks vienam gabalam, minūtēs
function machineMinutes(part) {
  const mat = findMaterial(part.materialId);
  const g = GROUPS[mat.group];
  const t = part.thickness;
  const geo = part.geo;
  const passes = Math.max(1, Math.ceil((t + MACHINE.throughCutMm) / g.ap));
  const contours = Math.max(1, geo.contours);
  const travelPerContour = Math.sqrt(Math.max(1, geo.sizeX * geo.sizeY) / contours);

  const cut = (geo.lengthMm + contours * MACHINE.leadInMm) * passes / g.feed;
  const plunge = contours * (t + MACHINE.throughCutMm) / g.plunge;
  const rapid = (contours * passes * MACHINE.retractMm * 2 + contours * travelPerContour) / MACHINE.rapidFeed;

  let rough = 0, finish = 0;
  if (geo.kind === '3d') {
    const pocketMm3 = Math.max(0, geo.projAreaMm2 * t - geo.volumeMm3);
    rough = pocketMm3 / (g.roughFeed * g.roughAp * g.roughAe);
    finish = geo.finishAreaMm2 / g.stepover / g.finishFeed;
  } else if (geo.reliefAreaMm2) {
    rough = geo.reliefAreaMm2 * g.reliefDepthMm / (g.roughFeed * g.roughAp * g.roughAe);
    finish = geo.reliefAreaMm2 / g.stepover / g.finishFeed;
  }

  const total = (cut + plunge + rapid + rough + finish) / MACHINE.efficiency + MACHINE.handlingMin;
  return { total, passes, cut: cut + plunge + rapid, mill: rough + finish };
}

function estimatePart(part) {
  const mat = findMaterial(part.materialId);
  const time = machineMinutes(part);
  const machineCost = time.total / 60 * PRICING.hourlyRate;
  const blankM2 = (part.geo.sizeX + MACHINE.partSpacingMm) * (part.geo.sizeY + MACHINE.partSpacingMm) / 1e6;
  const eurM2 = priceForThickness(mat, part.thickness);
  const materialCost = part.ownMaterial ? 0 : blankM2 * eurM2 * PRICING.materialWaste;
  const unit = machineCost + materialCost;
  return {
    unit, total: unit * part.quantity, machineCost, materialCost,
    minutes: time.total, passes: time.passes, blankM2, eurM2, mat
  };
}

function estimateOrder() {
  let partsTotal = 0;
  const setups = new Set();
  parts.forEach((p) => {
    partsTotal += estimatePart(p).total;
    setups.add(p.materialId + ':' + p.thickness);
  });
  const setupCost = setups.size * PRICING.setupMinutes / 60 * PRICING.hourlyRate;
  const fileCost = parts.length * PRICING.fileFee;
  const subtotal = partsTotal + setupCost + fileCost;
  const total = parts.length ? Math.max(PRICING.minOrder, subtotal) : 0;
  return { partsTotal, setupCost, setupCount: setups.size, fileCost, subtotal, total, minApplied: parts.length > 0 && subtotal < PRICING.minOrder };
}

/* ======================================================================
   Formatēšana
   ====================================================================== */
const eur = new Intl.NumberFormat('lv-LV', { style: 'currency', currency: 'EUR' });
const fmtEur = (v) => eur.format(v);
const fmtNum = (v, d = 1) => v.toLocaleString('lv-LV', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtMin = (min) => {
  const m = Math.max(1, Math.round(min));
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
};
const fmtDims = (p) => {
  const d = [p.geo.sizeX, p.geo.sizeY].map((v) => fmtNum(v, 0));
  return d.join(' × ') + ' × ' + fmtNum(p.thickness, p.thickness % 1 ? 1 : 0) + ' mm';
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ======================================================================
   DOM
   ====================================================================== */
const $ = (id) => document.getElementById(id);
const uploadScreen = $('cc-upload-screen');
const workspaceScreen = $('cc-workspace-screen');
const dropzone = $('cc-dropzone');
const fileInput = $('cc-file');
const fileInputMore = $('cc-file-more');
const uploadStatus = $('cc-upload-status');
const manualBtn = $('cc-manual');
const defaultMaterialSel = $('cc-default-material');
const backBtn = $('cc-back');
const addPartBtn = $('cc-add-part');
const addManualBtn = $('cc-add-manual');
const partsListEl = $('cc-parts-list');
const viewerEl = $('cc-viewer');
const hintEl = $('cc-viewer-hint');
const controlsEl = $('cc-controls');
const totalEl = $('cc-total');
const breakdownEl = $('cc-breakdown');
const countEl = $('cc-count');
const dimsEl = $('cc-dims');
const orderBtn = $('cc-order-btn');
const orderModal = $('cc-order-modal');
const orderClose = $('cc-order-close');
const orderForm = $('cc-order-form');
const orderSummaryEl = $('cc-order-summary');
const orderStatusEl = $('cc-order-status');
const orderSubmit = $('cc-order-submit');

/* ======================================================================
   Three.js skats (Z ass uz augšu, kā CNC iekārtai)
   ====================================================================== */
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
const HOME_DIR = new THREE.Vector3(0.9, -1.3, 1.1).normalize();
camera.position.copy(HOME_DIR).multiplyScalar(200);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
viewerEl.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(1, -1.2, 2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.45);
fill.position.set(-1, 1, -0.5);
scene.add(fill);

const ACCENT = 0xb64a1b;
const INK = 0x182120;
const partMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a27a, roughness: 0.7, metalness: 0.05, flatShading: true, side: THREE.DoubleSide });
const edgeMaterial = new THREE.LineBasicMaterial({ color: INK });
const contourMaterial = new THREE.LineBasicMaterial({ color: ACCENT });
const stockMaterial = new THREE.MeshBasicMaterial({ color: 0x8f9896, transparent: true, opacity: 0.1, depthWrite: false });
const stockEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x6f7876, transparent: true, opacity: 0.7 });

const MATERIAL_TINT = { wood: 0xc9a27a, mdf: 0xb89470, plywood: 0xd8b98c, acrylic: 0xbfd9e0, pvc: 0xf1f1ee, acp: 0xc8ccd0, hdpe: 0xeeeeea, aluminum: 0xb7bcc0 };

let modelGroup = null;

function resize() {
  const w = viewerEl.clientWidth || 1, h = viewerEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewerEl);
resize();

let fly = null;
renderer.setAnimationLoop((time) => {
  if (fly) {
    const t = Math.min(1, (time - fly.start) / 380);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(fly.from, fly.to, e);
    if (t >= 1) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
  renderViewCube();
});

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

function buildPartObject(part) {
  const group = new THREE.Group();
  const t = part.thickness;
  const geo = part.geo;
  const mat = findMaterial(part.materialId);
  partMaterial.color.setHex(MATERIAL_TINT[mat.group] || 0xc9a27a);

  if (part.kind === 'mesh') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.tris, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, partMaterial);
    group.add(mesh);
    if (geo.triangleCount < 150000) group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), edgeMaterial));
  } else if (part.kind === 'dxf') {
    for (const p of geo.paths) {
      const pts = p.pts.map((q) => new THREE.Vector3(q[0], q[1], t));
      if (p.closed && pts.length > 2) pts.push(pts[0].clone());
      const lg = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(lg, contourMaterial));
      const lg0 = new THREE.BufferGeometry().setFromPoints(pts.map((v) => new THREE.Vector3(v.x, v.y, 0)));
      group.add(new THREE.Line(lg0, edgeMaterial));
    }
  } else {
    const box = new THREE.BoxGeometry(geo.sizeX, geo.sizeY, t);
    const mesh = new THREE.Mesh(box, partMaterial);
    mesh.position.set(geo.sizeX / 2, geo.sizeY / 2, t / 2);
    group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), edgeMaterial);
    edges.position.copy(mesh.position);
    group.add(edges);
  }

  // Sagatave (loksnes gabals) ar 5 mm rezervi katrā pusē
  const minX = part.kind === 'dxf' ? geo.bounds.minX : part.kind === 'mesh' ? geo.bbox.minX : 0;
  const minY = part.kind === 'dxf' ? geo.bounds.minY : part.kind === 'mesh' ? geo.bbox.minY : 0;
  const minZ = part.kind === 'mesh' ? geo.bbox.minZ : 0;
  const pad = MACHINE.partSpacingMm / 2;
  const sx = geo.sizeX + pad * 2, sy = geo.sizeY + pad * 2;
  const stockGeo = new THREE.BoxGeometry(sx, sy, t);
  const stock = new THREE.Mesh(stockGeo, stockMaterial);
  stock.position.set(minX - pad + sx / 2, minY - pad + sy / 2, minZ + t / 2);
  group.add(stock);
  const stockEdges = new THREE.LineSegments(new THREE.EdgesGeometry(stockGeo), stockEdgeMaterial);
  stockEdges.position.copy(stock.position);
  group.add(stockEdges);

  // Galda režģis zem sagataves: 10 mm šūnas, 100 mm galvenās līnijas
  const gridSize = Math.ceil(Math.max(sx, sy) * 1.6 / 100) * 100;
  const fine = new THREE.GridHelper(gridSize, gridSize / 10, 0xd9d6cf, 0xe6e3dc);
  const major = new THREE.GridHelper(gridSize, gridSize / 100, 0xb9b5ac, 0xb9b5ac);
  [fine, major].forEach((g, i) => {
    g.rotation.x = Math.PI / 2;
    g.position.set(minX + geo.sizeX / 2, minY + geo.sizeY / 2, minZ - 0.05 - i * 0.01);
    g.material.transparent = true;
    g.material.opacity = i ? 0.55 : 0.8;
    g.material.depthWrite = false;
    group.add(g);
  });

  // Centrē ap 0
  const c = new THREE.Vector3(minX + geo.sizeX / 2, minY + geo.sizeY / 2, minZ + t / 2);
  group.children.forEach((o) => o.position.sub(c));
  return group;
}

function showModel(part, refit) {
  if (modelGroup) { scene.remove(modelGroup); disposeGroup(modelGroup); modelGroup = null; }
  if (!part) { hintEl.hidden = false; dimsEl.textContent = ''; return; }
  hintEl.hidden = true;
  dimsEl.textContent = fmtDims(part);
  modelGroup = buildPartObject(part);
  scene.add(modelGroup);
  if (refit) {
    const r = Math.max(part.geo.sizeX, part.geo.sizeY, part.thickness) * 0.75;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
    controls.target.set(0, 0, 0);
    camera.position.copy(HOME_DIR).multiplyScalar(dist);
    camera.near = dist / 100; camera.far = dist * 100;
    camera.updateProjectionMatrix();
  }
}

/* ----- Skata kubs ----- */
const cubeScene = new THREE.Scene();
const cubeCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
const cubeGroup = new THREE.Group();
cubeScene.add(cubeGroup);
const FACES = { px: [1, 0, 0, 'LABA'], nx: [-1, 0, 0, 'KREISĀ'], py: [0, 1, 0, 'AIZMUG.'], ny: [0, -1, 0, 'PRIEKŠA'], pz: [0, 0, 1, 'AUGŠA'], nz: [0, 0, -1, 'APAKŠA'] };
const cubeTargets = [];
let cubeRenderer = null;

function faceSprite(dir, label) {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 160;
  const ctx = cv.getContext('2d');
  ctx.font = '600 30px "JetBrains Mono", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#182120';
  ctx.fillText(label, 80, 80);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  s.scale.setScalar(0.9);
  s.position.set(dir[0] * 0.75, dir[1] * 0.75, dir[2] * 0.75);
  s.userData.dir = dir;
  return s;
}

(function initViewCube() {
  const box = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  cubeGroup.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xf4f3ef })));
  cubeGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: INK })));
  Object.values(FACES).forEach((f) => {
    const s = faceSprite(f, f[3]);
    cubeGroup.add(s);
    cubeTargets.push(s);
  });
  const cv = document.createElement('canvas');
  cv.className = 'cc-view-cube';
  cv.title = 'Skata virziens';
  viewerEl.appendChild(cv);
  cubeRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  cubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  cubeRenderer.setSize(92, 92, false);
  const ray = new THREE.Raycaster();
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cubeCamera);
    const hit = ray.intersectObjects(cubeTargets)[0];
    if (!hit) return;
    e.stopPropagation();
    const d = hit.object.userData.dir;
    const dist = camera.position.distanceTo(controls.target);
    const to = new THREE.Vector3(d[0], d[1] - (d[2] ? 0.001 : 0), d[2]).normalize().multiplyScalar(dist);
    fly = { from: camera.position.clone(), to, start: performance.now() };
  });
})();

function renderViewCube() {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  cubeCamera.position.copy(dir).multiplyScalar(3);
  cubeCamera.up.copy(camera.up);
  cubeCamera.lookAt(0, 0, 0);
  if (cubeRenderer) cubeRenderer.render(cubeScene, cubeCamera);
}

/* ======================================================================
   Stāvoklis un failu ielāde
   ====================================================================== */
let parts = [];
let activeId = null;
let seq = 0;

const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const ACCEPT = ['dxf', 'stl', 'obj', 'step', 'stp'];
const extOf = (n) => (n.split('.').pop() || '').toLowerCase();

function setUploadStatus(text, isError) {
  uploadStatus.textContent = text || '';
  uploadStatus.classList.toggle('is-error', !!isError);
}

async function readMeshTriangles(file, ext) {
  if (ext === 'step' || ext === 'stp') return readStepTriangles(await file.arrayBuffer());
  let object;
  if (ext === 'stl') object = new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer()));
  else object = new OBJLoader().parse(await file.text());
  object.updateMatrixWorld(true);
  const chunks = [];
  let total = 0;
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = g.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    }
    chunks.push(arr);
    total += arr.length;
  });
  if (!total) throw new Error('Modelī netika atrasta ģeometrija.');
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function defaultThicknessFor(materialId, minT) {
  const mat = findMaterial(materialId);
  const ok = mat.sheets.filter((s) => s.t >= minT - 0.05);
  if (ok.length) return ok[0].t;
  return Math.ceil(minT);
}

function remesh(part) {
  part.tris = orientTriangles(part.rawTris, part.axis, part.units);
  part.geo = analyzeMesh(part.tris);
  part.minThickness = part.geo.sizeZ;
  if (!part.thickness || part.thickness < part.minThickness - 0.05) {
    part.thickness = defaultThicknessFor(part.materialId, part.minThickness);
  }
}

async function addFile(file) {
  const ext = extOf(file.name);
  if (ACCEPT.indexOf(ext) === -1) {
    setUploadStatus('Neatbalstīts formāts: ' + file.name + '. Kalkulators nolasa DXF, STL, OBJ un STEP failus.', true);
    return;
  }
  if (file.size > 60 * 1024 * 1024) {
    setUploadStatus('Fails ' + file.name + ' ir lielāks par 60 MB. Lūdzu, nosūtiet to kopā ar pieteikumu.', true);
    return;
  }
  setUploadStatus((ext === 'step' || ext === 'stp' ? 'Ielādējam STEP lasītāju un nolasām ' : 'Nolasām ') + file.name + '…');
  await new Promise((r) => setTimeout(r, 30));

  const materialId = defaultMaterialSel.value || DEFAULT_MATERIAL;
  const part = { id: ++seq, name: file.name, file, ext, materialId, quantity: 1, ownMaterial: false, warnings: [] };
  try {
    if (ext === 'dxf') {
      part.kind = 'dxf';
      part.geo = parseDxf(await file.text());
      const mat = findMaterial(materialId);
      part.thickness = mat.sheets.some((s) => s.t === DEFAULT_THICKNESS) ? DEFAULT_THICKNESS : mat.sheets[Math.floor(mat.sheets.length / 2)].t;
      if (part.geo.hasBlocks) part.warnings.push('Failā ir bloki (INSERT), kurus kalkulators neizvērš. Kontūru garums var būt lielāks.');
      if (part.geo.skipped) part.warnings.push('Izlaidām ' + part.geo.skipped + ' objektus (teksts, izmēri, šrafējums), kurus negriež.');
    } else {
      part.kind = 'mesh';
      part.rawTris = await readMeshTriangles(file, ext);
      part.units = 1;
      part.axis = thinnestAxis(part.rawTris);
      remesh(part);
    }
  } catch (err) {
    setUploadStatus('Neizdevās nolasīt ' + file.name + ': ' + err.message, true);
    return;
  }
  parts.push(part);
  setActive(part.id, true);
  updateUploadStatus();
}

async function loadFiles(list) {
  const before = parts.length;
  for (const f of Array.from(list || [])) await addFile(f);
  if (parts.length > before && uploadScreen.classList.contains('is-active')) showWorkspace();
}

function addManualPart() {
  const materialId = defaultMaterialSel.value || DEFAULT_MATERIAL;
  const part = {
    id: ++seq, name: 'Detaļa bez faila', kind: 'manual', materialId, quantity: 1, ownMaterial: false, warnings: [],
    manual: { length: 600, width: 400, shape: 'rect', relief: 0 }
  };
  const mat = findMaterial(materialId);
  part.thickness = mat.sheets.some((s) => s.t === DEFAULT_THICKNESS) ? DEFAULT_THICKNESS : mat.sheets[0].t;
  updateManualGeo(part);
  parts.push(part);
  setActive(part.id, true);
  updateUploadStatus();
}

function updateManualGeo(part) {
  const m = part.manual;
  const shapeFactor = { rect: 1, complex: 2.2 }[m.shape] || 1;
  part.geo = {
    kind: '2d',
    sizeX: m.length, sizeY: m.width,
    lengthMm: 2 * (m.length + m.width) * shapeFactor,
    contours: m.shape === 'complex' ? 4 : 1,
    reliefAreaMm2: m.length * m.width * (m.relief / 100)
  };
}

function removePart(id) {
  parts = parts.filter((p) => p.id !== id);
  if (activeId === id) activeId = parts.length ? parts[parts.length - 1].id : null;
  if (!parts.length) { showUpload(); }
  setActive(activeId, true);
  updateUploadStatus();
}

function getActive() { return parts.find((p) => p.id === activeId) || null; }

function setActive(id, refit) {
  activeId = id;
  const part = getActive();
  showModel(part, refit);
  renderPartsList();
  renderControls();
  renderPrice();
}

function updateUploadStatus() {
  countEl.textContent = parts.length;
  if (parts.length && !uploadStatus.classList.contains('is-error')) {
    setUploadStatus('Pievienotas detaļas: ' + parts.map((p) => p.name).join(', '));
  }
}

/* ======================================================================
   Saskarne
   ====================================================================== */
function partWarnings(part) {
  const w = part.warnings.slice();
  if (!fitsWorkArea(part.geo.sizeX, part.geo.sizeY)) {
    w.push('Detaļa pārsniedz darba lauku ' + MACHINE.bedY + ' × ' + MACHINE.bedX + ' mm. Sazinieties ar mums par sadalīšanu vairākos elementos.');
  }
  if (part.kind === 'mesh') {
    const mat = findMaterial(part.materialId);
    if (!mat.sheets.some((s) => s.t >= part.minThickness - 0.05)) {
      w.push('Detaļas augstums ' + fmtNum(part.minThickness) + ' mm pārsniedz biezāko pieejamo materiālu. Cena ir aptuvena.');
    }
    if (mat.group === 'acp' && part.geo.finishAreaMm2 > 0) w.push('Kompozītpaneļos 3D reljefu nefrēzējam. Lūdzu, izvēlieties citu materiālu.');
  }
  return w;
}

function renderPartsList() {
  partsListEl.innerHTML = '';
  parts.forEach((p) => {
    const e = estimatePart(p);
    const li = document.createElement('li');
    li.className = 'cc-part' + (p.id === activeId ? ' is-active' : '');
    const type = p.kind === 'manual' ? 'IZM' : p.ext.toUpperCase().replace('STP', 'STEP');
    li.innerHTML =
      '<button type="button" class="cc-part-btn"' + (p.id === activeId ? ' aria-current="true"' : '') + '>' +
        '<span class="cc-part-top"><span class="cc-tag">' + type + '</span><span class="cc-part-name">' + escapeHtml(p.name) + '</span></span>' +
        '<span class="cc-part-meta">' + fmtDims(p) + '</span>' +
        '<span class="cc-part-meta">' + escapeHtml(e.mat.label) + '</span>' +
        '<span class="cc-part-bottom"><span>' + p.quantity + ' gab.</span><strong>' + fmtEur(e.total) + '</strong></span>' +
        (partWarnings(p).length ? '<span class="cc-part-warn">Jāpārbauda</span>' : '') +
      '</button>' +
      '<button type="button" class="cc-part-remove" aria-label="Noņemt detaļu ' + escapeHtml(p.name) + '">' + ICON_X + '</button>';
    li.querySelector('.cc-part-btn').addEventListener('click', () => setActive(p.id, true));
    li.querySelector('.cc-part-remove').addEventListener('click', () => removePart(p.id));
    partsListEl.appendChild(li);
  });
}

function materialOptions(selected) {
  return Object.keys(GROUPS).map((gk) => {
    const opts = MATERIALS.filter((m) => m.group === gk)
      .map((m) => '<option value="' + m.id + '"' + (m.id === selected ? ' selected' : '') + '>' + escapeHtml(m.label) + '</option>').join('');
    return opts ? '<optgroup label="' + escapeHtml(GROUPS[gk].label) + '">' + opts + '</optgroup>' : '';
  }).join('');
}

function thicknessOptions(part) {
  const mat = findMaterial(part.materialId);
  const min = part.kind === 'mesh' ? part.minThickness - 0.05 : 0;
  let opts = mat.sheets.map((s) =>
    '<option value="' + s.t + '"' + (s.t === part.thickness ? ' selected' : '') + (s.t < min ? ' disabled' : '') + '>' +
      fmtNum(s.t, s.t % 1 ? 1 : 0) + ' mm' + (s.t < min ? ' (par plānu)' : '') + '</option>').join('');
  if (!mat.sheets.some((s) => s.t === part.thickness)) {
    opts += '<option value="' + part.thickness + '" selected>' + fmtNum(part.thickness, part.thickness % 1 ? 1 : 0) + ' mm (pēc pieprasījuma)</option>';
  }
  return opts;
}

function renderControls() {
  const part = getActive();
  if (!part) { controlsEl.innerHTML = ''; return; }
  const e = estimatePart(part);
  const isMesh = part.kind === 'mesh';
  const isManual = part.kind === 'manual';
  const kindLabel = part.kind === 'dxf' ? '2D kontūrgriešana (DXF)' : isManual ? 'Izmēri ievadīti manuāli' : (part.geo.finishAreaMm2 > 1 ? '3D frēzēšana' : '2,5D frēzēšana') + ' (' + part.ext.toUpperCase() + ')';

  let html = '<div class="cc-controls-head"><h2 class="cc-controls-title">' + escapeHtml(part.name) + '</h2><p class="cc-controls-kind">' + kindLabel + '</p></div>' +
    '<div class="cc-controls-body">';

  if (isManual) {
    html +=
      '<div class="cc-row2">' +
        '<div class="cc-group"><label class="cc-label" for="cc-m-len">Garums, mm</label><input class="cc-input" id="cc-m-len" type="number" min="1" max="2500" value="' + part.manual.length + '"></div>' +
        '<div class="cc-group"><label class="cc-label" for="cc-m-wid">Platums, mm</label><input class="cc-input" id="cc-m-wid" type="number" min="1" max="2500" value="' + part.manual.width + '"></div>' +
      '</div>' +
      '<div class="cc-group"><label class="cc-label" for="cc-m-shape">Kontūra</label><select class="cc-select" id="cc-m-shape">' +
        '<option value="rect"' + (part.manual.shape === 'rect' ? ' selected' : '') + '>Taisnstūris</option>' +
        '<option value="complex"' + (part.manual.shape === 'complex' ? ' selected' : '') + '>Sarežģīta forma ar izgriezumiem</option>' +
      '</select></div>' +
      '<div class="cc-group"><label class="cc-label" for="cc-m-relief">3D reljefs vai gravējums, % no virsmas</label><input class="cc-input" id="cc-m-relief" type="number" min="0" max="100" step="5" value="' + part.manual.relief + '"></div>';
  }

  html +=
    '<div class="cc-group"><label class="cc-label" for="cc-material">Materiāls</label><select class="cc-select" id="cc-material">' + materialOptions(part.materialId) + '</select></div>' +
    '<div class="cc-row2">' +
      '<div class="cc-group"><label class="cc-label" for="cc-thickness">Biezums</label><select class="cc-select" id="cc-thickness">' + thicknessOptions(part) + '</select></div>' +
      '<div class="cc-group"><label class="cc-label" for="cc-qty">Daudzums</label>' +
        '<div class="cc-qty"><button type="button" id="cc-qty-minus" aria-label="Samazināt daudzumu">' + ICON_MINUS + '</button><input id="cc-qty" type="number" min="1" max="9999" value="' + part.quantity + '" aria-label="Daudzums"><button type="button" id="cc-qty-plus" aria-label="Palielināt daudzumu">' + ICON_PLUS + '</button></div>' +
      '</div>' +
    '</div>';

  if (isMesh) {
    html +=
      '<div class="cc-row2">' +
        '<div class="cc-group"><label class="cc-label" for="cc-units">Faila vienības</label><select class="cc-select" id="cc-units">' +
          [[1, 'mm'], [10, 'cm'], [1000, 'm'], [25.4, 'collas']].map((u) => '<option value="' + u[0] + '"' + (u[0] === part.units ? ' selected' : '') + '>' + u[1] + '</option>').join('') +
        '</select></div>' +
        '<div class="cc-group"><label class="cc-label" for="cc-axis">Biezuma ass</label><select class="cc-select" id="cc-axis">' +
          ['x', 'y', 'z'].map((a) => '<option value="' + a + '"' + (a === part.axis ? ' selected' : '') + '>' + a.toUpperCase() + '</option>').join('') +
        '</select></div>' +
      '</div>' +
      '<p class="cc-hint">STL, OBJ un STEP failos vienības parasti ir milimetri. Biezuma ass ir virziens, no kura frēze apstrādā detaļu.</p>';
  }

  html +=
    '<label class="cc-check"><input type="checkbox" id="cc-own"' + (part.ownMaterial ? ' checked' : '') + '><span>Materiālu atvedīšu pats</span></label>';

  const warns = partWarnings(part);
  if (warns.length) html += '<div class="cc-warn" role="alert">' + warns.map(escapeHtml).join('<br>') + '</div>';

  html += '</div>' +
    '<div class="cc-summary">' +
      '<div class="cc-sum-row"><span>Gabarīti</span><strong>' + fmtDims(part) + '</strong></div>' +
      (part.geo.lengthMm ? '<div class="cc-sum-row"><span>Griezuma garums</span><strong>' + fmtNum(part.geo.lengthMm / 1000, 2) + ' m</strong></div>' : '') +
      '<div class="cc-sum-row"><span>Mašīnlaiks, gab.</span><strong>' + fmtMin(e.minutes) + '</strong></div>' +
      '<div class="cc-sum-row"><span>Materiāls, gab.</span><strong>' + (part.ownMaterial ? 'klienta' : fmtEur(e.materialCost)) + '</strong></div>' +
      '<div class="cc-sum-row"><span>Cena, gab.</span><strong>' + fmtEur(e.unit) + '</strong></div>' +
      '<div class="cc-sum-row cc-sum-total"><span>Kopā, ' + part.quantity + ' gab.</span><strong>' + fmtEur(e.total) + '</strong></div>' +
    '</div>';

  controlsEl.innerHTML = html;
  bindControls(part);
}

function bindControls(part) {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const refresh = (refit) => { showModel(part, refit); renderPartsList(); renderControls(); renderPrice(); };

  on('cc-material', 'change', (ev) => {
    part.materialId = ev.target.value;
    const mat = findMaterial(part.materialId);
    if (part.kind === 'mesh') part.thickness = defaultThicknessFor(part.materialId, part.minThickness);
    else if (!mat.sheets.some((s) => s.t === part.thickness)) {
      part.thickness = mat.sheets.reduce((a, s) => (Math.abs(s.t - part.thickness) < Math.abs(a.t - part.thickness) ? s : a), mat.sheets[0]).t;
    }
    refresh(false);
  });
  on('cc-thickness', 'change', (ev) => { part.thickness = parseFloat(ev.target.value); refresh(false); });
  const setQty = (v) => { part.quantity = Math.min(9999, Math.max(1, v || 1)); refresh(false); };
  on('cc-qty', 'change', (ev) => setQty(parseInt(ev.target.value, 10)));
  on('cc-qty-minus', 'click', () => setQty(part.quantity - 1));
  on('cc-qty-plus', 'click', () => setQty(part.quantity + 1));
  on('cc-own', 'change', (ev) => { part.ownMaterial = ev.target.checked; refresh(false); });
  on('cc-units', 'change', (ev) => { part.units = parseFloat(ev.target.value); part.thickness = 0; remesh(part); refresh(true); });
  on('cc-axis', 'change', (ev) => { part.axis = ev.target.value; part.thickness = 0; remesh(part); refresh(true); });
  const manualField = (id, prop, min, max) => on(id, 'change', (ev) => {
    const v = parseFloat(ev.target.value);
    part.manual[prop] = isFinite(v) ? Math.min(max, Math.max(min, v)) : part.manual[prop];
    updateManualGeo(part);
    refresh(prop !== 'relief');
  });
  manualField('cc-m-len', 'length', 1, 5000);
  manualField('cc-m-wid', 'width', 1, 5000);
  manualField('cc-m-relief', 'relief', 0, 100);
  on('cc-m-shape', 'change', (ev) => { part.manual.shape = ev.target.value; updateManualGeo(part); refresh(false); });
}

function renderPrice() {
  const o = estimateOrder();
  totalEl.textContent = fmtEur(o.total);
  orderBtn.disabled = !parts.length;
  if (!parts.length) { breakdownEl.innerHTML = ''; return; }
  const item = (label, value) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  breakdownEl.innerHTML =
    item('Detaļas', fmtEur(o.partsTotal)) +
    item('Sagatavošana', fmtEur(o.setupCost)) +
    item('Faila apstrāde', fmtEur(o.fileCost)) +
    (o.minApplied ? item('Līdz minimumam', '+ ' + fmtEur(PRICING.minOrder - o.subtotal)) : '');
}

/* ======================================================================
   Ekrāni
   ====================================================================== */
function showWorkspace() {
  if (!parts.length) return;
  uploadScreen.classList.remove('is-active');
  workspaceScreen.classList.add('is-active');
  requestAnimationFrame(() => { resize(); setActive(activeId || parts[0].id, true); });
  workspaceScreen.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showUpload() {
  workspaceScreen.classList.remove('is-active');
  uploadScreen.classList.add('is-active');
}

/* ======================================================================
   Pasūtījums
   ====================================================================== */
function orderText(form) {
  const o = estimateOrder();
  const lines = ['Avots: cncpakalpojumi.lv kalkulators', ''];
  lines.push('Klients: ' + form.name);
  lines.push('E-pasts: ' + form.email);
  if (form.phone) lines.push('Tālrunis: ' + form.phone);
  if (form.company) lines.push('Uzņēmums: ' + form.company);
  if (form.link) lines.push('Failu saite: ' + form.link);
  lines.push('');
  parts.forEach((p, i) => {
    const e = estimatePart(p);
    lines.push((i + 1) + '. ' + p.name + (p.kind === 'manual' ? ' (' + (p.manual.shape === 'rect' ? 'taisnstūris' : 'sarežģīta forma') + (p.manual.relief ? ', reljefs ' + p.manual.relief + ' %' : '') + ')' : ''));
    lines.push('   Gabarīti: ' + fmtDims(p));
    lines.push('   Materiāls: ' + e.mat.label + (p.ownMaterial ? ' (klienta materiāls)' : ''));
    lines.push('   Daudzums: ' + p.quantity + ' gab.');
    lines.push('   Mašīnlaiks: ' + fmtMin(e.minutes) + ' / gab.');
    lines.push('   Cena: ' + fmtEur(e.total));
    lines.push('');
  });
  lines.push('Sagatavošana (' + o.setupCount + '): ' + fmtEur(o.setupCost));
  lines.push('Faila apstrāde (' + parts.length + '): ' + fmtEur(o.fileCost));
  if (o.minApplied) lines.push('Piemērota minimālā pasūtījuma summa.');
  lines.push('KOPĀ (bez PVN, orientējoši): ' + fmtEur(o.total));
  if (form.message) { lines.push(''); lines.push('Komentārs: ' + form.message); }
  return lines.join('\n');
}

function renderOrderSummary() {
  const o = estimateOrder();
  orderSummaryEl.innerHTML = parts.map((p) => {
    const e = estimatePart(p);
    return '<div class="cc-order-item"><div><strong>' + escapeHtml(p.name) + '</strong> · ' + p.quantity + ' gab.</div>' +
      '<div>' + fmtDims(p) + ' · ' + escapeHtml(e.mat.label) + '</div><div>' + fmtEur(e.total) + '</div></div>';
  }).join('') +
    '<div class="cc-order-total">Kopā: <strong>' + fmtEur(o.total) + '</strong> <span>bez PVN, orientējoši</span></div>';
}

function openOrder() {
  if (!parts.length) return;
  renderOrderSummary();
  orderStatusEl.textContent = '';
  orderStatusEl.className = 'cc-form-status';
  orderModal.hidden = false;
  document.body.style.overflow = 'hidden';
  $('cc-order-name').focus();
}

function closeOrder() {
  orderModal.hidden = true;
  document.body.style.overflow = '';
  orderBtn.focus();
}

orderForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = {
    name: $('cc-order-name').value.trim(),
    email: $('cc-order-email').value.trim(),
    phone: $('cc-order-phone').value.trim(),
    company: $('cc-order-company').value.trim(),
    link: $('cc-order-link').value.trim(),
    message: $('cc-order-message').value.trim()
  };
  if (!form.name || !/^\S+@\S+\.\S+$/.test(form.email)) {
    orderStatusEl.className = 'cc-form-status is-error';
    orderStatusEl.textContent = 'Lūdzu, norādiet vārdu un derīgu e-pasta adresi.';
    return;
  }
  orderSubmit.disabled = true;
  orderSubmit.textContent = 'Nosūta…';
  const text = orderText(form);
  try {
    const res = await fetch(PRICING.formEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, email: form.email, message: text, form_identifier: PRICING.formIdentifier })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    orderStatusEl.className = 'cc-form-status is-ok';
    orderStatusEl.textContent = 'Paldies. Pieteikums nosūtīts, un nākamajā darba dienā atbildēsim ar precīzu cenu.';
    orderForm.reset();
  } catch (err) {
    const mail = 'mailto:' + PRICING.email + '?subject=' + encodeURIComponent('CNC cenu pieprasījums') + '&body=' + encodeURIComponent(text);
    orderStatusEl.className = 'cc-form-status is-error';
    orderStatusEl.innerHTML = 'Neizdevās nosūtīt. <a href="' + mail + '">Nosūtiet pieteikumu e-pastā</a> uz ' + PRICING.email + '.';
  }
  orderSubmit.disabled = false;
  orderSubmit.textContent = 'Nosūtīt pieteikumu';
});

/* ======================================================================
   Notikumi
   ====================================================================== */
defaultMaterialSel.innerHTML = materialOptions(DEFAULT_MATERIAL);

function bindDrop(zone, input) {
  zone.addEventListener('click', (e) => { if (!e.target.closest('button, select, input, a, label')) input.click(); });
  zone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button, select, input, a')) { e.preventDefault(); input.click(); }
  });
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('is-drag'); }));
  zone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });
  input.addEventListener('change', () => { if (input.files.length) { loadFiles(input.files).then(() => { input.value = ''; }); } });
}
bindDrop(dropzone, fileInput);

addPartBtn.addEventListener('click', () => fileInputMore.click());
fileInputMore.addEventListener('change', () => { if (fileInputMore.files.length) loadFiles(fileInputMore.files).then(() => { fileInputMore.value = ''; }); });
addManualBtn.addEventListener('click', addManualPart);
manualBtn.addEventListener('click', () => { addManualPart(); showWorkspace(); });
backBtn.addEventListener('click', showUpload);
orderBtn.addEventListener('click', openOrder);
orderClose.addEventListener('click', closeOrder);
orderModal.addEventListener('click', (e) => { if (e.target === orderModal) closeOrder(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !orderModal.hidden) closeOrder(); });

// Testiem un atkļūdošanai
window.__cncCalc = { get parts() { return parts; }, estimatePart, estimateOrder, loadFiles };

updateUploadStatus();
renderPrice();
