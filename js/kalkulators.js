/* ==========================================================================
   CNC PAKALPOJUMI — cenu kalkulatora aprēķina loģika
   --------------------------------------------------------------------------
   Tīrs, bez atkarībām strādājošs modulis. Satur:
     - Konfigurācijas tabulas (materiāli, sarežģītība, konstantes)
     - Validācijas funkcijas (darba lauks, ievaddati)
     - Aprēķina funkcijas (mašīnlaiks → cena → diapazons)
     - Publisko API (izmantots gan pārlūkā, gan Node testiem)

   Visas likmes var viegli pielāgot zemāk esošajās tabulās.
   ========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;                 // Node (testiem)
  } else {
    root.CNCCalculator = api;             // pārlūks
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ------------------------------------------------------------------------
     KONFIGURĀCIJA — šeit klients var mainīt likmes un koeficientus
     ------------------------------------------------------------------------ */

  // Iekārtas darba lauks (mm)
  var WORK_AREA = {
    length: 2500,
    width: 1300
  };

  // Materiālu tabula
  //   rate               — €/h bāzes likme
  //   materialCostPerM2  — aptuvenas materiāla izmaksas €/m²
  //   passDepth          — griešanas dziļums vienā gājienā (mm)
  //   timePerMetre       — laiks minūtēs uz 1 m griezuma vienā gājienā
  var MATERIALS = {
    wood: {
      label: 'Koks / MDF / Saplāksnis',
      rate: 25,
      materialCostPerM2: 15,
      passDepth: 5,
      timePerMetre: 2.5
    },
    plastic: {
      label: 'Plastmasa / Akrils / Kompozīti',
      rate: 30,
      materialCostPerM2: 35,
      passDepth: 4,
      timePerMetre: 3
    },
    aluminum: {
      label: 'Alumīnijs / Mīkstie metāli',
      rate: 45,
      materialCostPerM2: 90,
      passDepth: 2,
      timePerMetre: 4.5
    }
  };

  // Apstrādes sarežģītības koeficienti
  var COMPLEXITY = {
    simple: { label: 'Vienkārša 2D kontūrgriešana', multiplier: 1.0 },
    complex: { label: 'Sarežģīta forma, daudz detaļu', multiplier: 1.5 },
    relief3d: { label: '3D reljefs / gravējums', multiplier: 2.2 }
  };

  // Aprēķina konstantes
  var SETUP_HOURS = 0.25;   // fiksēts mašīnas uzstādīšanas laiks (h)
  var MIN_PRICE = 15;       // minimālā pasūtījuma cena (€)
  var RANGE_LOW = 0.9;      // cenu diapazona apakšējā robeža
  var RANGE_HIGH = 1.15;    // cenu diapazona augšējā robeža

  /* ------------------------------------------------------------------------
     VALIDĀCIJA
     ------------------------------------------------------------------------ */

  /**
   * Pārbauda, vai detaļa iekļaujas darba laukā 1300 × 2500 mm.
   * Detaļu drīkst pagriezt — tādēļ tiek pārbaudītas abas orientācijas.
   */
  function isWithinWorkArea(length, width) {
    return (length <= WORK_AREA.length && width <= WORK_AREA.width) ||
           (length <= WORK_AREA.width && width <= WORK_AREA.length);
  }

  /**
   * Pārbauda visus ievaddatus un atgriež kļūdu sarakstu (tukšs = derīgi).
   */
  function validate(input) {
    var errors = [];

    if (!MATERIALS[input.material]) {
      errors.push({ field: 'material', message: 'Izvēlieties materiālu.' });
    }
    if (!COMPLEXITY[input.complexity]) {
      errors.push({ field: 'complexity', message: 'Izvēlieties apstrādes veidu.' });
    }

    var thickness = Number(input.thickness);
    if (!isFinite(thickness) || thickness <= 0) {
      errors.push({ field: 'thickness', message: 'Norādiet derīgu biezumu (mm).' });
    }

    var length = Number(input.length);
    var width = Number(input.width);
    if (!isFinite(length) || length <= 0) {
      errors.push({ field: 'length', message: 'Norādiet derīgu garumu (mm).' });
    }
    if (!isFinite(width) || width <= 0) {
      errors.push({ field: 'width', message: 'Norādiet derīgu platumu (mm).' });
    }

    if (isFinite(length) && isFinite(width) && length > 0 && width > 0 &&
        !isWithinWorkArea(length, width)) {
      errors.push({
        field: 'size',
        message: 'Pārsniedz mūsu iekārtas darba lauku (1300 × 2500 mm) — sazinieties, lai apspriestu detaļas sadalīšanu vairākos elementos.'
      });
    }

    var quantity = Number(input.quantity);
    if (!isFinite(quantity) || quantity < 1) {
      errors.push({ field: 'quantity', message: 'Daudzumam jābūt vismaz 1.' });
    }

    return errors;
  }

  /* ------------------------------------------------------------------------
     APRĒĶINS
     ------------------------------------------------------------------------ */

  /**
   * Aprēķina orientējošo cenu.
   * Atgriež objektu ar:
   *   low, high    — cenu diapazons (€, noapaļots)
   *   areaM2       — detaļas laukums (m²)
   *   machineHours — aptuvenais mašīnlaiks (h)
   *   passes       — griešanas gājienu skaits
   *   unitPrice    — vienas detaļas cena (€)
   */
  function calculateEstimate(input) {
    var material = MATERIALS[input.material];
    var complexity = COMPLEXITY[input.complexity];

    var thickness = Number(input.thickness);
    var length = Number(input.length);
    var width = Number(input.width);
    var quantity = Number(input.quantity);

    // Izmēri metros
    var l = length / 1000;
    var w = width / 1000;

    var area = l * w;                 // m²
    var perimeter = 2 * (l + w);      // m

    // Gājienu skaits — cik reizes jāiziet cauri biezumam
    var passes = Math.max(1, Math.ceil(thickness / material.passDepth));

    // Griešanas laiks minūtēs → stundās + fiksēts uzstādīšanas laiks
    var cuttingMinutes = perimeter * passes * material.timePerMetre;
    var machineHours = SETUP_HOURS + (cuttingMinutes / 60);

    // Darba izmaksas (ar sarežģītības koeficientu)
    var laborCost = material.rate * complexity.multiplier * machineHours;

    // Materiāla izmaksas (aptuvens pieskaitījums pēc laukuma)
    var materialCost = area * material.materialCostPerM2;

    // Vienas detaļas un kopējā cena
    var unitPrice = laborCost + materialCost;
    var totalMid = unitPrice * quantity;

    // Diapazons — atstāj rezervi nenoteiktībai, bet ne zem minimālās cenas
    var low = Math.max(MIN_PRICE, Math.round(totalMid * RANGE_LOW));
    var high = Math.max(MIN_PRICE, Math.round(totalMid * RANGE_HIGH));

    return {
      low: low,
      high: high,
      areaM2: area,
      machineHours: machineHours,
      passes: passes,
      unitPrice: unitPrice,
      totalMid: totalMid
    };
  }

  /**
   * Noformē cenu diapazonu tekstā, piem. "28–35 €".
   */
  function formatPriceRange(low, high) {
    if (low === high) return low + ' €';
    return low + '–' + high + ' €';
  }

  /* ------------------------------------------------------------------------
     PUBLISKAIS API
     ------------------------------------------------------------------------ */
  return {
    WORK_AREA: WORK_AREA,
    MATERIALS: MATERIALS,
    COMPLEXITY: COMPLEXITY,
    isWithinWorkArea: isWithinWorkArea,
    validate: validate,
    calculateEstimate: calculateEstimate,
    formatPriceRange: formatPriceRange
  };
});
