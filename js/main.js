/* ==========================================================================
   CNC PAKALPOJUMI — galvenais skripts
   1. Sticky header · 2. Mobilā izvēlne · 3. FAQ akordeons
   4. Kontaktformas validācija · 5. Scroll reveal · 6. Gads
   7. Kalkulatora pārnese · 8. Karuselis
   ========================================================================== */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var header = document.getElementById('site-header');
  var navToggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('galvena-navigacija');

  // 1. Sticky header
  function onScroll() {
    if (!header) return;
    header.classList.toggle('site-header--scrolled', window.scrollY > 8);
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
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navToggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
        navToggle.setAttribute('aria-label', 'Atvērt izvēlni');
      });
    });
  }

  // 3. FAQ akordeons
  document.querySelectorAll('.accordion__item').forEach(function (item) {
    var btn = item.querySelector('.accordion__header');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var isOpen = item.classList.contains('is-open');
      document.querySelectorAll('.accordion__item.is-open').forEach(function (open) {
        if (open !== item) {
          open.classList.remove('is-open');
          var b = open.querySelector('.accordion__header');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('is-open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  // 4. Kontaktformas validācija
  var contactForm = document.getElementById('kontaktu-forma');
  if (contactForm) {
    var nameEl = document.getElementById('kontakti-vards');
    var emailEl = document.getElementById('kontakti-epasts');
    var msgEl = document.getElementById('kontakti-zinojums');

    function setErr(input, msg) {
      var err = document.getElementById(input.id + '-error');
      if (err) {
        err.textContent = msg || '';
        err.classList.toggle('is-visible', !!msg);
      }
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    contactForm.addEventListener('submit', function (e) {
      var ok = true;
      if (!nameEl.value.trim()) { setErr(nameEl, 'Lūdzu, norādiet savu vārdu.'); ok = false; } else setErr(nameEl, '');
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim());
      if (!emailEl.value.trim() || !emailOk) { setErr(emailEl, 'Lūdzu, norādiet derīgu e-pasta adresi.'); ok = false; } else setErr(emailEl, '');
      if (!msgEl.value.trim()) { setErr(msgEl, 'Lūdzu, ierakstiet ziņojumu.'); ok = false; } else setErr(msgEl, '');
      if (!ok) e.preventDefault();
    });

    [nameEl, emailEl, msgEl].forEach(function (el) {
      el.addEventListener('input', function () { setErr(el, ''); });
    });
  }

  // 5. Scroll reveal
  var revealEls = document.querySelectorAll('[data-reveal]');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      revealEls.forEach(function (el) { io.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    }
  }

  // 6. Gads
  var yearEl = document.getElementById('gads');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // 7. Kalkulatora pārnese
  try {
    var q = new URLSearchParams(window.location.search).get('zinojums');
    if (q) {
      var msg = document.getElementById('kontakti-zinojums');
      if (msg) msg.value = q;
    }
  } catch (err) {}

  // 8. Karuselis
  var carousel = document.getElementById('karuselis');
  if (carousel) {
    var prevBtn = carousel.parentElement.querySelector('[data-carousel-prev]');
    var nextBtn = carousel.parentElement.querySelector('[data-carousel-next]');
    function scrollCards(dir) {
      var card = carousel.querySelector('.carousel__card');
      var amount = card ? card.offsetWidth + 20 : 320;
      carousel.scrollBy({ left: dir * amount, behavior: 'smooth' });
    }
    if (prevBtn) prevBtn.addEventListener('click', function () { scrollCards(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { scrollCards(1); });
  }
})();
