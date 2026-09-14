/* ==========================================================================
   Parallax šovkeisa animācija (GSAP ScrollTrigger + Lenis)
   --------------------------------------------------------------------------
   Katrs elements ar data-parallax-layer kustas citā ātrumā, radot dziļuma
   efektu. Lenis nodrošina gludu skrollēšanu.
   ========================================================================== */

(function () {
  'use strict';

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;

  if (!gsap || !ScrollTrigger) return;

  var layers = document.querySelector('[data-parallax-layers]');
  if (!layers) return;

  gsap.registerPlugin(ScrollTrigger);

  // Dziļuma kārtas: mazāks skaitlis = lēnāka kustība
  var configs = [
    { layer: '1', y: -80 },
    { layer: '2', y: -140 },
    { layer: '3', y: -220 }
  ];

  configs.forEach(function (cfg) {
    var el = layers.querySelector('[data-parallax-layer="' + cfg.layer + '"]');
    if (!el) return;

    gsap.fromTo(el, { y: 0 }, {
      y: cfg.y,
      ease: 'none',
      scrollTrigger: {
        trigger: layers,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 0.6
      }
    });
  });

  // Lenis — gluda skrollēšana (tikai ja pieejama)
  if (window.Lenis) {
    // Izslēdz CSS smooth, lai Lenis pārņemtu skrollēšanu
    document.documentElement.style.scrollBehavior = 'auto';

    var lenis = new window.Lenis({ smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (time) {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
  }
})();
