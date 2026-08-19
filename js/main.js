/* ==========================================================================
   CNC PAKALPOJUMI — galvenais skripts
   --------------------------------------------------------------------------
   Atbild par:
     1. Sticky header stāvokli pie scroll
     2. Mobilo izvēlni (hamburger)
   Pārējā funkcionalitāte (FAQ akordeons, scroll animācijas u.c.) tiks
   pievienota turpmākajos soļos.
   ========================================================================== */

(function () {
  'use strict';

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
})();
