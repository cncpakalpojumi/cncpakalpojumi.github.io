// js/cnc-materials.js — iekārtas parametri, likmes un materiālu katalogs
// Visas cenas bez PVN. Materiālu cenas €/m² – Latvijas tirgus vidējās (2026. gada oktobris).

// Wattsan A1-1325: darba lauks 1300 × 2500 mm, Z gājiens 200 mm, vārpsta 3 kW / 24 000 apgr./min,
// ER20 cangas patrona, soļu motori, zobstieņa piedziņa, tukšgaita līdz 15 000 mm/min, vakuuma galds.
export const MACHINE = {
  bedX: 2500,
  bedY: 1300,
  zTravel: 200,
  rapidFeed: 9000,      // mm/min — vidējais reālais tukšgaitas ātrums ar paātrinājumu (maks. 15 000)
  efficiency: 0.8,      // stūri, paātrinājums, ieejas – reālais laiks ≈ teorētiskais ÷ 0,8
  throughCutMm: 0.5,    // griezums 0,5 mm dziļāk par materiālu
  leadInMm: 8,          // ieeja/izeja katrai kontūrai
  retractMm: 10,        // Z pacelšana starp gājieniem
  handlingMin: 0.5,     // detaļas noņemšana un notīrīšana, min/gab.
  partSpacingMm: 10     // attālums starp detaļām loksnē (5 mm katrā pusē)
};

export const PRICING = {
  hourlyRate: 60,       // €/h mašīnlaiks
  fileFee: 30,          // € par katru detaļu (faila apstrāde un programma)
  setupMinutes: 15,     // iekārtas sagatavošana katram materiāla un biezuma veidam
  materialWaste: 1.15,  // loksnes atgriezumi +15 %
  minOrder: 100,        // € minimālā pasūtījuma summa
  email: 'razosana@bratus.lv',
  formEndpoint: 'https://shopforms.vercel.app/api/send-email',
  formIdentifier: 'manufacturing'
};

// Griešanas režīmi 6 mm frēzei (2D) un 3 mm lodveida frēzei (3D apdare) ar 3 kW vārpstu.
// feed – kontūras griešana mm/min · ap – dziļums vienā gājienā mm · plunge – iegremdēšana mm/min
// rough* – rupjā frēzēšana (noņemšanas ātrums = feed × ap × ae) · finishFeed / stepover – 3D apdare
// reliefDepthMm – vidējais reljefa dziļums, ja izmērus ievada manuāli
export const GROUPS = {
  mdf:      { label: 'MDF',                     feed: 3500, ap: 6,   plunge: 1200, roughFeed: 3000, roughAp: 4,   roughAe: 3, finishFeed: 4500, stepover: 0.4, reliefDepthMm: 4 },
  plywood:  { label: 'Saplāksnis',              feed: 3000, ap: 5,   plunge: 1000, roughFeed: 3000, roughAp: 3,   roughAe: 3, finishFeed: 4000, stepover: 0.4, reliefDepthMm: 3 },
  wood:     { label: 'Masīvkoks',               feed: 3000, ap: 5,   plunge: 1000, roughFeed: 2800, roughAp: 3,   roughAe: 3, finishFeed: 4000, stepover: 0.4, reliefDepthMm: 4 },
  acrylic:  { label: 'Akrils (PMMA)',           feed: 2000, ap: 3,   plunge: 500,  roughFeed: 2000, roughAp: 2,   roughAe: 3, finishFeed: 3000, stepover: 0.3, reliefDepthMm: 2 },
  pvc:      { label: 'PVC putuplasts',          feed: 4000, ap: 5,   plunge: 1500, roughFeed: 4000, roughAp: 4,   roughAe: 3, finishFeed: 5000, stepover: 0.4, reliefDepthMm: 3 },
  hdpe:     { label: 'Polietilēns (HDPE)',      feed: 2500, ap: 4,   plunge: 800,  roughFeed: 2500, roughAp: 3,   roughAe: 3, finishFeed: 3000, stepover: 0.3, reliefDepthMm: 3 },
  acp:      { label: 'Alumīnija kompozīts',     feed: 3000, ap: 3.5, plunge: 1000, roughFeed: 2500, roughAp: 2,   roughAe: 3, finishFeed: 3000, stepover: 0.3, reliefDepthMm: 1 },
  aluminum: { label: 'Alumīnijs',               feed: 900,  ap: 0.5, plunge: 200,  roughFeed: 900,  roughAp: 0.5, roughAe: 2, finishFeed: 1200, stepover: 0.2, reliefDepthMm: 1 }
};

// sheets: [{ t: biezums mm, eurM2: cena €/m² bez PVN }]
// Avoti (2026-10-26): Depo, EAMF, KatesPlates, Patatimber, Ultraplast, Kviller, Sanistal.
// Alumīnijs 1 mm un 4–10 mm – aprēķināts no Sanistal €/kg (≈7,2–8,5 €/kg), jo cenas publiski nav pieejamas.
// HDPE 20 mm – aprēķināts no 10 mm cenas.
export const MATERIALS = [
  { id: 'mdf', group: 'mdf', label: 'MDF, neapstrādāts', sheets: [
    { t: 3, eurM2: 4 }, { t: 6, eurM2: 6.5 }, { t: 10, eurM2: 8.5 }, { t: 12, eurM2: 9.5 },
    { t: 16, eurM2: 11.5 }, { t: 18, eurM2: 12.5 }, { t: 22, eurM2: 16 }, { t: 25, eurM2: 19 } ] },
  { id: 'plywood-birch', group: 'plywood', label: 'Bērza saplāksnis', sheets: [
    { t: 4, eurM2: 11.5 }, { t: 6, eurM2: 11.5 }, { t: 9, eurM2: 13 }, { t: 12, eurM2: 15 },
    { t: 15, eurM2: 17.5 }, { t: 18, eurM2: 19.5 }, { t: 21, eurM2: 23.5 } ] },
  { id: 'glued-panel', group: 'wood', label: 'Līmētā koka plātne (egle, priede)', sheets: [
    { t: 18, eurM2: 18.5 }, { t: 28, eurM2: 28 } ] },
  { id: 'acrylic-clear', group: 'acrylic', label: 'Akrils, caurspīdīgs', sheets: [
    { t: 2, eurM2: 13 }, { t: 3, eurM2: 19.5 }, { t: 4, eurM2: 26 }, { t: 5, eurM2: 32.5 },
    { t: 6, eurM2: 39 }, { t: 8, eurM2: 52 }, { t: 10, eurM2: 65 } ] },
  { id: 'pvc-foam', group: 'pvc', label: 'PVC putuplasta plātne (Forex tipa)', sheets: [
    { t: 3, eurM2: 6.5 }, { t: 5, eurM2: 11 }, { t: 10, eurM2: 23 } ] },
  { id: 'hdpe', group: 'hdpe', label: 'HDPE plātne', sheets: [
    { t: 10, eurM2: 58.5 }, { t: 20, eurM2: 120 } ] },
  { id: 'acp', group: 'acp', label: 'Alumīnija kompozītpanelis', sheets: [
    { t: 3, eurM2: 14.5 } ] },
  { id: 'aluminum', group: 'aluminum', label: 'Alumīnija loksne', sheets: [
    { t: 1, eurM2: 23 }, { t: 2, eurM2: 38 }, { t: 3, eurM2: 60 }, { t: 4, eurM2: 79 },
    { t: 5, eurM2: 98.5 }, { t: 6, eurM2: 118 }, { t: 8, eurM2: 155.5 }, { t: 10, eurM2: 194.5 } ] }
];

export const DEFAULT_MATERIAL = 'mdf';
export const DEFAULT_THICKNESS = 18;
