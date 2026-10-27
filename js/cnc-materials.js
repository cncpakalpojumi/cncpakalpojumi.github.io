// js/cnc-materials.js — iekārtas parametri, likmes un materiālu katalogs
// Visas cenas bez PVN. Materiālu cenas €/m² – Latvijas tirgus vidējās (2026. gada oktobris).

// Wattsan M3-1325: darba lauks 1300 × 2500 mm, Z gājiens 300 mm, gaisa dzesēta vārpsta 4,5 kW / 18 000 apgr./min,
// automātiska instrumentu maiņa (8 instrumenti), Leadshine 0,75 kW servomotori ar Shimpo planetārajiem reduktoriem,
// slīpzobu zobstienis X/Y, lodskrūve Z, tukšgaita līdz 25 000 mm/min, vakuuma galds (6 zonas).
// Wattsan lapā ir arī 7,5 kW un 60 000 mm/min – aprēķinā lietotas piesardzīgākās vērtības.
export const MACHINE = {
  bedX: 2500,
  bedY: 1300,
  zTravel: 300,
  rapidFeed: 15000,     // mm/min — vidējais reālais tukšgaitas ātrums ar paātrinājumu (maks. 25 000)
  zRapidFeed: 5000,     // mm/min — Z ass pacelšana un nolaišana
  accel: 600,           // mm/s² — pieņemtais griešanas paātrinājums; ierobežo ātrumu mazos lokos (v = √(a·r))
  efficiency: 0.9,      // stūri uz taisniem posmiem – reālais laiks ≈ teorētiskais ÷ 0,9
  contourOverheadS: 1.5,// s katrai kontūrai: bremzēšana, pārbrauciens, pieeja
  passOverheadS: 0.5,   // s katram gājienam: nolaišana nākamajā dziļumā, paātrināšanās
  safeZMm: 5,           // drošais augstums virs materiāla
  toolChangeS: 20,      // s viena automātiskā instrumenta maiņa (vienreiz uz detaļu rindu)
  drillApproachS: 1,    // s urbuma pieeja un izeja
  peckS: 0.4,           // s viena urbja izcelšana skaidu izvadīšanai
  throughCutMm: 0.5,    // griezums 0,5 mm dziļāk par materiālu
  leadInMm: 8,          // ieeja/izeja katrai kontūrai
  retractMm: 10,        // Z pacelšana starp gājieniem
  handlingMin: 0.5,     // detaļas noņemšana un notīrīšana, min/gab.
  partSpacingMm: 12     // attālums starp detaļām loksnē (8 mm frēze + rezerve)
};

// Instrumenti. Frēzes: diametrs d un griezējdaļas garums flute (maks. griešanas dziļums), mm.
// Urbjus izmanto apaļiem caurumiem līdz drillMaxD, ja biezums ≤ drillDepthFactor × d.
// toolFit: frēzes diametrs ≤ toolFit × cauruma vai spraugas platums.
export const TOOLS = {
  endmills: [
    { d: 8, flute: 32 }, { d: 6, flute: 22 }, { d: 4, flute: 16 },
    { d: 3, flute: 12 }, { d: 2, flute: 8 }, { d: 1.5, flute: 6 }
  ],
  drillMinD: 1,
  drillMaxD: 13,
  drillDepthFactor: 10,
  toolFit: 0.8
};

export const PRICING = {
  hourlyRate: 60,       // €/h mašīnlaiks
  fileFee: 30,          // € par katru detaļu (faila apstrāde un programma)
  setupMinutes: 15,     // iekārtas sagatavošana katram materiāla un biezuma veidam
  materialWaste: 1.15,  // loksnes atgriezumi +15 %
  minOrder: 100,        // € minimālā pasūtījuma summa
  showPrices: false,    // false – lapā rāda „Cena pēc pieprasījuma”; aprēķins darbojas fonā (sk. cenu-aprekins.md)
  email: 'razosana@bratus.lv',
  formEndpoint: 'https://shopforms.vercel.app/api/send-email',
  formIdentifier: 'manufacturing'
};

// Griešanas režīmi 4,5 kW vārpstai ar automātisko instrumentu maiņu:
// kontūras – 8 mm spirālfrēze (akrilam un alumīnijam 6 mm vienas spirāles frēze),
// rupjā 3D frēzēšana – 12 mm plakanā frēze, 3D apdare – 6 mm lodveida frēze.
// feed – kontūras griešana mm/min · ap – dziļums vienā gājienā mm · plunge – iegremdēšana mm/min
// rough* – rupjā frēzēšana (noņemšanas ātrums = feed × ap × ae) · finishFeed / stepover – 3D apdare
// reliefDepthMm – vidējais reljefa dziļums, ja izmērus ievada manuāli
// baseTool – frēze, kurai dotas feed/ap/plunge; mazākām frēzēm: ap × d/baseTool, feed un plunge × √(d/baseTool)
// drillFeed – urbšanas padeve, mm/min
export const GROUPS = {
  mdf:      { label: 'MDF',                     feed: 5000, ap: 8,   plunge: 1500, roughFeed: 4000, roughAp: 5,   roughAe: 6, finishFeed: 6000, stepover: 0.5,  reliefDepthMm: 4, baseTool: 8, drillFeed: 1200 },
  plywood:  { label: 'Saplāksnis',              feed: 4500, ap: 7,   plunge: 1500, roughFeed: 4000, roughAp: 4,   roughAe: 6, finishFeed: 5500, stepover: 0.5,  reliefDepthMm: 3, baseTool: 8, drillFeed: 1000 },
  wood:     { label: 'Masīvkoks',               feed: 4500, ap: 7,   plunge: 1500, roughFeed: 3500, roughAp: 4,   roughAe: 6, finishFeed: 5500, stepover: 0.5,  reliefDepthMm: 4, baseTool: 8, drillFeed: 1000 },
  acrylic:  { label: 'Akrils (PMMA)',           feed: 3000, ap: 4,   plunge: 800,  roughFeed: 3000, roughAp: 3,   roughAe: 4, finishFeed: 4000, stepover: 0.4,  reliefDepthMm: 2, baseTool: 6, drillFeed: 400 },
  pvc:      { label: 'PVC putuplasts',          feed: 6000, ap: 8,   plunge: 2000, roughFeed: 6000, roughAp: 6,   roughAe: 6, finishFeed: 7000, stepover: 0.5,  reliefDepthMm: 3, baseTool: 8, drillFeed: 1500 },
  hdpe:     { label: 'Polietilēns (HDPE)',      feed: 3500, ap: 5,   plunge: 1000, roughFeed: 3500, roughAp: 4,   roughAe: 5, finishFeed: 4000, stepover: 0.4,  reliefDepthMm: 3, baseTool: 8, drillFeed: 800 },
  acp:      { label: 'Alumīnija kompozīts',     feed: 4500, ap: 3.5, plunge: 1500, roughFeed: 3500, roughAp: 2,   roughAe: 4, finishFeed: 4000, stepover: 0.4,  reliefDepthMm: 1, baseTool: 8, drillFeed: 600 },
  aluminum: { label: 'Alumīnijs',               feed: 1500, ap: 1,   plunge: 300,  roughFeed: 1500, roughAp: 1,   roughAe: 3, finishFeed: 2000, stepover: 0.25, reliefDepthMm: 1, baseTool: 6, drillFeed: 250 }
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
