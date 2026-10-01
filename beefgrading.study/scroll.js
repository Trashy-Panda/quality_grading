/* ============================================================
   SCROLL REVEALS - scroll.js
   ============================================================
   Scroll-driven entrance choreography for the long scrolling surfaces
   (landing, field guide, leaderboard, power rankings).

   WHY INTERSECTIONOBSERVER AND NOT A SCROLL HANDLER
   The project's design-taste preflight hard-fails on
   `addEventListener('scroll', ...)`, and rightly so: a scroll listener
   runs work on the main thread for every scroll tick. IntersectionObserver
   is fired by the browser only at threshold crossings, costs nothing in
   between, and needs no rAF loop. Continuous scroll-*linked* effects
   (parallax, scrub) are done in CSS with `animation-timeline`, which runs
   off the main thread entirely. There is no JS scroll handler anywhere.

   HOW IT COOPERATES WITH THE .hidden SCREEN ROUTER
   The app shows/hides screens by toggling `.hidden` (display:none) from
   three separate routers (app.js, leaderboard.js, powerrank.js). We do not
   touch any of them. IntersectionObserver reports isIntersecting:false for
   anything inside a display:none subtree and fires again when it becomes
   visible, so reveals simply work when a screen is shown.

   The one gap is that `.is-in` is sticky, so navigating away and back would
   show already-revealed content with no replay. That is handled here with a
   MutationObserver that watches the screens for `.hidden` being re-added and
   resets them, reusing the exact pattern already proven in index.html for
   the drill header. Still zero router changes.

   MARKUP CONTRACT
     data-reveal                  opt into the reveal
     data-reveal="stagger"        also index children into --i for a cascade
     data-reveal-delay="120"      extra delay in ms, written to --reveal-delay

   All the actual animation lives in CSS keyed off `.is-in`.
   ============================================================ */

'use strict';

(function () {
  var REVEAL_SELECTOR = '[data-reveal]';
  var observer = null;

  function prefersReducedMotion() {
    return window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Children of a stagger container get an index so CSS can compute
     `calc(var(--i) * 40ms)`. One observer entry for the container beats
     N observer entries for N rows. */
  function indexStaggerChildren(node) {
    if (node.getAttribute('data-reveal') !== 'stagger') return;
    var kids = node.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.setProperty('--i', i);
    }
  }

  function markIn(node) {
    var delay = node.getAttribute('data-reveal-delay');
    if (delay) node.style.setProperty('--reveal-delay', delay + 'ms');
    indexStaggerChildren(node);
    node.classList.add('is-in');
  }

  function getObserver() {
    if (observer) return observer;
    observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;
        markIn(entry.target);
        // One-shot: stop watching once revealed. Replay on re-entry is
        // handled by resetScrollReveals(), not by re-firing here.
        observer.unobserve(entry.target);
      }
    }, {
      // Fire a little before the element is fully on screen so the motion
      // reads as "already happening" rather than "triggered by my scroll".
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.01
    });
    return observer;
  }

  /* Idempotent: safe to call repeatedly, including after JS injects rows
     (leaderboard and power rankings both build their tables at runtime). */
  function initScrollReveals(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll(REVEAL_SELECTOR);
    if (!nodes.length) return;

    if (prefersReducedMotion()) {
      // No observer at all. Content resolves immediately and stays put;
      // never animate-then-snap, which is worse than not animating.
      for (var i = 0; i < nodes.length; i++) markIn(nodes[i]);
      return;
    }

    var io = getObserver();
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].classList.contains('is-in')) continue;
      io.observe(nodes[j]);
    }
  }

  /* Strip .is-in inside a subtree so its choreography replays next time the
     screen is shown. */
  function resetScrollReveals(root) {
    var scope = root || document;
    if (prefersReducedMotion()) return;   // nothing to replay
    var nodes = scope.querySelectorAll(REVEAL_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('is-in');
      if (observer) observer.observe(nodes[i]);
    }
  }

  /* Watch the screen containers for `.hidden` coming back, and reset that
     screen's reveals when it does. Same mechanism index.html already uses to
     drive the drill header, so this is a reused convention, not a new one. */
  function watchScreens() {
    if (prefersReducedMotion()) return;
    var screens = document.querySelectorAll(
      'main.screen, #landing-hero, #drill-screen'
    );
    if (!screens.length) return;

    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var target = mutations[i].target;
        if (target.classList && target.classList.contains('hidden')) {
          resetScrollReveals(target);
        }
      }
    });
    for (var j = 0; j < screens.length; j++) {
      mo.observe(screens[j], { attributes: true, attributeFilter: ['class'] });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initScrollReveals();
    watchScreens();
  });

  // Exposed for the two surfaces that build their rows after render.
  window.initScrollReveals = initScrollReveals;
  window.resetScrollReveals = resetScrollReveals;
})();
