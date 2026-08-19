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

/* ==========================================================================
   UI SAISTE — saista aprēķina loģiku ar kalkulatora formu lapā.
   Darbojas, ja lapā ir <form id="cenu-kalkulators">.
   ========================================================================== */
(function () {
  'use strict';

  var form = document.getElementById('cenu-kalkulators');
  if (!form || typeof window.CNCCalculator === 'undefined') return;

  var calc = window.CNCCalculator;

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

  var fieldElements = {
    material: materialEl,
    thickness: thicknessEl,
    length: lengthEl,
    width: widthEl,
    quantity: quantityEl
  };

  var fieldErrorIds = {
    material: 'calc-material-error',
    thickness: 'calc-thickness-error',
    length: 'calc-length-error',
    width: 'calc-width-error',
    quantity: 'calc-quantity-error'
  };

  function readInputs() {
    var checked = form.querySelector('input[name="complexity"]:checked');
    return {
      material: materialEl.value,
      complexity: checked ? checked.value : '',
      thickness: thicknessEl.value,
      length: lengthEl.value,
      width: widthEl.value,
      quantity: quantityEl.value
    };
  }

  function clearErrors() {
    form.querySelectorAll('.field__error').forEach(function (el) {
      el.textContent = '';
      el.classList.remove('is-visible');
    });
    Object.keys(fieldElements).forEach(function (key) {
      var el = fieldElements[key];
      if (el) el.setAttribute('aria-invalid', 'false');
    });
    if (warningEl) {
      warningEl.textContent = '';
      warningEl.classList.remove('is-visible');
    }
  }

  function renderErrors(errors) {
    clearErrors();
    errors.forEach(function (err) {
      if (err.field === 'size') {
        if (warningEl) {
          warningEl.textContent = err.message;
          warningEl.classList.add('is-visible');
        }
        if (lengthEl) lengthEl.setAttribute('aria-invalid', 'true');
        if (widthEl) widthEl.setAttribute('aria-invalid', 'true');
        return;
      }
      var errEl = document.getElementById(fieldErrorIds[err.field]);
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.add('is-visible');
      }
      var input = fieldElements[err.field];
      if (input) input.setAttribute('aria-invalid', 'true');
    });
  }

  function formatEuro(value) {
    return value.toFixed(2).replace('.', ',') + ' €';
  }

  function showEmptyState() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    priceEl.textContent = '—';
    if (hintEl) hintEl.hidden = false;
    if (breakdownEl) breakdownEl.hidden = true;
    if (unitEl) unitEl.textContent = '—';
    if (hoursEl) hoursEl.textContent = '—';
    if (passesEl) passesEl.textContent = '—';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.removeAttribute('data-summary');
    }
  }

  var rafId = null;
  function animatePrice(low, high) {
    if (rafId) cancelAnimationFrame(rafId);
    var duration = 500;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var progress = Math.min(1, (ts - start) / duration);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var curLow = Math.round(low * eased);
      var curHigh = Math.round(high * eased);
      priceEl.textContent = calc.formatPriceRange(curLow, curHigh);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        priceEl.textContent = calc.formatPriceRange(low, high);
        rafId = null;
      }
    }
    rafId = requestAnimationFrame(step);
  }

  function buildSummary(input, result) {
    var mat = calc.MATERIALS[input.material].label;
    var cx = calc.COMPLEXITY[input.complexity].label;
    return 'Kalkulatora tāme: ' + mat + ', ' +
      input.length + '×' + input.width + '×' + input.thickness + ' mm, ' +
      cx + ', ' + input.quantity + ' gab. → ' +
      calc.formatPriceRange(result.low, result.high);
  }

  function recalculate() {
    var input = readInputs();
    var errors = calc.validate(input);

    if (errors.length) {
      renderErrors(errors);
      showEmptyState();
      return;
    }

    renderErrors([]);
    var result = calc.calculateEstimate(input);

    if (hintEl) hintEl.hidden = true;
    if (breakdownEl) breakdownEl.hidden = false;
    if (unitEl) unitEl.textContent = formatEuro(result.unitPrice);
    if (hoursEl) hoursEl.textContent = result.machineHours.toFixed(2) + ' h';
    if (passesEl) passesEl.textContent = String(result.passes);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.dataset.summary = buildSummary(input, result);
    }

    animatePrice(result.low, result.high);
  }

  // Notikumu klausītāji — pārrēķins pie katras ievades
  [materialEl, thicknessEl, lengthEl, widthEl, quantityEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', recalculate);
    el.addEventListener('change', recalculate);
  });
  form.querySelectorAll('input[name="complexity"]').forEach(function (radio) {
    radio.addEventListener('change', recalculate);
  });

  // "Nosūtīt šo pieprasījumu" — pārnes tāmi uz kontaktformu
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
        window.location.href = 'kontakti.html?zinojums=' + encodeURIComponent(summary);
      }
    });
  }

  recalculate();
})();
