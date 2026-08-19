/* ==========================================================================
   CNC PAKALPOJUMI — galvenais skripts
   --------------------------------------------------------------------------
   1. Sticky header stāvoklis pie scroll
   2. Mobilā izvēlne (hamburger)
   3. FAQ akordeons
   4. Kontaktformas validācija
   5. Scroll reveal (IntersectionObserver)
   6. Gads footerī
   ========================================================================== */

(function () {
  'use strict';

  // Ļauj CSS zināt, ka JavaScript ir pieejams (scroll reveal)
  document.documentElement.classList.add('js');

  var header = document.getElementById('site-header');
  var navToggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('galvena-navigacija');

  // 1. Sticky header — pievieno ēnu, kad lapa ir nedaudz uzritināta
  function onScroll() {
    if (!header) return;
    if (window.scrollY > 8) {
      header.classList.add('site-header--scrolled');
    } else {
      header.classList.remove('site-header--scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 2. Mobilā izvēlne
  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!isOpen));
      nav.classList.toggle('is-open', !isOpen);
      navToggle.setAttribute('aria-label', isOpen ? 'Atvērt izvēlni' : 'Aizvērt izvēlni');
    });

    // Aizvērt izvēlni pēc klikšķa uz jebkuras saites
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navToggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
        navToggle.setAttribute('aria-label', 'Atvērt izvēlni');
      });
    });
  }

  // 3. FAQ akordeons — viens atvērts vienlaikus
  document.querySelectorAll('.accordion__item').forEach(function (item) {
    var headerBtn = item.querySelector('.accordion__header');
    if (!headerBtn) return;

    headerBtn.addEventListener('click', function () {
      var isOpen = item.classList.contains('is-open');

      document.querySelectorAll('.accordion__item.is-open').forEach(function (openItem) {
        if (openItem !== item) {
          openItem.classList.remove('is-open');
          var btn = openItem.querySelector('.accordion__header');
          if (btn) btn.setAttribute('aria-expanded', 'false');
        }
      });

      item.classList.toggle('is-open', !isOpen);
      headerBtn.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  // 4. Kontaktformas validācija
  var contactForm = document.getElementById('kontaktu-forma');
  if (contactForm) {
    var nameEl = document.getElementById('kontakti-vards');
    var emailEl = document.getElementById('kontakti-epasts');
    var msgEl = document.getElementById('kontakti-zinojums');

    function setContactError(input, message) {
      var errorEl = document.getElementById(input.id + '-error');
      if (errorEl) {
        errorEl.textContent = message || '';
        errorEl.classList.toggle('is-visible', !!message);
      }
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    contactForm.addEventListener('submit', function (e) {
      var valid = true;

      if (!nameEl.value.trim()) {
        setContactError(nameEl, 'Lūdzu, norādiet savu vārdu.');
        valid = false;
      } else {
        setContactError(nameEl, '');
      }

      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim());
      if (!emailEl.value.trim() || !emailOk) {
        setContactError(emailEl, 'Lūdzu, norādiet derīgu e-pasta adresi.');
        valid = false;
      } else {
        setContactError(emailEl, '');
      }

      if (!msgEl.value.trim()) {
        setContactError(msgEl, 'Lūdzu, ierakstiet ziņojumu.');
        valid = false;
      } else {
        setContactError(msgEl, '');
      }

      // Ja dati nav derīgi — apturam formu; pretējā gadījumā ļaujam mailto: darbībai
      if (!valid) {
        e.preventDefault();
      }
    });

    // Reāllaika kļūdu notīrīšana
    [nameEl, emailEl, msgEl].forEach(function (el) {
      el.addEventListener('input', function () {
        setContactError(el, '');
      });
    });
  }

  // 5. Scroll reveal
  var revealEls = document.querySelectorAll('[data-reveal]');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

      revealEls.forEach(function (el) { observer.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    }
  }

  // 6. Gads footerī
  var yearEl = document.getElementById('gads');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // 7. Kalkulatora pārnese — aizpilda ziņojumu no URL parametra ?zinojums=
  try {
    var params = new URLSearchParams(window.location.search);
    var prefilled = params.get('zinojums');
    if (prefilled) {
      var prefilledMsg = document.getElementById('kontakti-zinojums');
      if (prefilledMsg) prefilledMsg.value = prefilled;
    }
  } catch (err) {
    // ignorējam — parametrs nav obligāts
  }

  // 8. Frēzes ceļa animācija (hero) — oranžais punkts ceļo pa ceļu
  var frezPath = document.getElementById('frez-path');
  var frezDot = document.getElementById('frez-dot');
  if (frezPath && frezDot && typeof frezPath.getTotalLength === 'function') {
    var pathLength = frezPath.getTotalLength();

    function placeFrezDot(distance) {
      var point = frezPath.getPointAtLength(distance);
      frezDot.setAttribute('cx', point.x.toFixed(2));
      frezDot.setAttribute('cy', point.y.toFixed(2));
    }

    var reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (pathLength > 0 && !reduceMotion) {
      var cycleDuration = 9000; // ms pilnam ceļa aplim
      var frezStart = null;
      function frezStep(timestamp) {
        if (frezStart === null) frezStart = timestamp;
        var elapsed = (timestamp - frezStart) % cycleDuration;
        placeFrezDot((elapsed / cycleDuration) * pathLength);
        requestAnimationFrame(frezStep);
      }
      requestAnimationFrame(frezStep);
    } else if (pathLength > 0) {
      placeFrezDot(0); // statisks punkts sākumā
    }
  }
})();
