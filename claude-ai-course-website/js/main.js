/* ==========================================================================
   js/main.js — site behaviour (vanilla JS, no dependencies)
   Handles: sticky header state, mobile nav, scroll reveal, copy-to-clipboard
   prompt buttons, sticky mobile CTA, footer year, config-driven text, and a
   small helper API used by checkout.js (window.CourseUI).
   ========================================================================== */
(function () {
  'use strict';

  var cfg = window.COURSE_CONFIG || {};

  /* --- Helpers ---------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function formatInr(value) {
    var n = Number(value);
    if (!isFinite(n)) return '';
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR', maximumFractionDigits: 0
      }).format(n);
    } catch (e) {
      return '₹' + n.toLocaleString('en-IN');
    }
  }

  /* --- Apply config values to the DOM ---------------------------------- */
  function applyConfig() {
    var price = formatInr(cfg.priceInr || 0);
    var original = formatInr(cfg.originalPriceInr || 0);

    if (price) {
      $$('[data-price-label]').forEach(function (el) { el.textContent = price; });
    }
    if (original) {
      $$('[data-original-price-label]').forEach(function (el) { el.textContent = original; });
    }
    if (cfg.priceInr && cfg.originalPriceInr && cfg.originalPriceInr > cfg.priceInr) {
      var save = formatInr(cfg.originalPriceInr - cfg.priceInr);
      $$('[data-save-label]').forEach(function (el) { el.textContent = 'Save ' + save; });
    } else {
      /* Never show a discount we cannot justify. */
      $$('[data-save-label]').forEach(function (el) { el.remove(); });
      $$('[data-original-price-label]').forEach(function (el) { el.remove(); });
    }

    if (cfg.supportEmail) {
      $$('[data-support-email]').forEach(function (el) {
        el.textContent = cfg.supportEmail;
        if (el.tagName === 'A') el.setAttribute('href', 'mailto:' + cfg.supportEmail);
      });
    }
    if (cfg.supportHours) {
      $$('[data-support-hours]').forEach(function (el) { el.textContent = cfg.supportHours; });
    }

    /* Page count: shown ONLY when a real number is configured. */
    var pages = parseInt(cfg.pdfPageCount, 10);
    var wrap = $('[data-page-count-wrap]');
    var pending = $('[data-page-count-pending]');
    if (pages > 0) {
      var target = $('[data-page-count]');
      if (target) target.textContent = String(pages);
      if (wrap) wrap.hidden = false;
      if (pending) pending.hidden = true;
    } else {
      if (wrap) wrap.hidden = true;
      if (pending) pending.hidden = false;
    }

    var yearEls = $$('[data-year]');
    var y = String(new Date().getFullYear());
    yearEls.forEach(function (el) { el.textContent = y; });
  }

  /* --- Sticky header ---------------------------------------------------- */
  function initHeader() {
    var header = $('#siteHeader');
    var toggle = $('#navToggle');
    var menu = $('#navMenu');

    if (header) {
      var onScroll = function () {
        if (window.scrollY > 8) header.classList.add('is-stuck');
        else header.classList.remove('is-stuck');
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        var open = menu.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      /* Close after tapping a link (mobile) */
      menu.addEventListener('click', function (e) {
        if (e.target.closest('a') && window.innerWidth < 900) {
          menu.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  /* --- Smooth anchor scrolling with a fixed-header offset --------------- */
  function initAnchors() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      var id = link.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      var header = $('#siteHeader');
      var offset = header ? header.offsetHeight + 12 : 12;
      var top = target.getBoundingClientRect().top + window.scrollY - offset;
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
      if (history.replaceState) history.replaceState(null, '', id);
    });
  }

  /* --- Scroll reveal ---------------------------------------------------- */
  function initReveal() {
    var items = $$('.reveal');
    if (!items.length) return;

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* --- Copy prompt buttons --------------------------------------------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    /* Fallback for older browsers / non-secure contexts */
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy-failed'));
      } catch (err) { reject(err); }
    });
  }

  function initCopyButtons() {
    $$('[data-copy]').forEach(function (btn) {
      var original = btn.textContent;
      btn.addEventListener('click', function () {
        var sel = btn.getAttribute('data-copy');
        var src = sel ? document.querySelector(sel) : null;
        if (!src) return;
        copyText(src.innerText || src.textContent || '').then(function () {
          btn.textContent = 'Copied ✓';
          btn.classList.add('is-copied');
          window.setTimeout(function () {
            btn.textContent = original;
            btn.classList.remove('is-copied');
          }, 1800);
        }).catch(function () {
          btn.textContent = 'Press Ctrl/Cmd + C';
          window.setTimeout(function () { btn.textContent = original; }, 2200);
        });
      });
    });
  }

  /* --- Sticky mobile CTA ----------------------------------------------- */
  function initStickyCta() {
    var cta = $('#stickyCta');
    if (!cta) return;
    var pricing = $('#pricing');
    var ticking = false;

    function update() {
      ticking = false;
      var pastHero = window.scrollY > 520;
      var pricingVisible = false;
      if (pricing) {
        var r = pricing.getBoundingClientRect();
        pricingVisible = r.top < window.innerHeight * 0.75 && r.bottom > 0;
      }
      var show = pastHero && !pricingVisible;
      cta.classList.toggle('is-visible', show);
      cta.setAttribute('aria-hidden', show ? 'false' : 'true');
      /* Keep it out of the tab order while hidden */
      cta.querySelectorAll('a, button').forEach(function (el) {
        if (show) el.removeAttribute('tabindex');
        else el.setAttribute('tabindex', '-1');
      });
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* --- Minimal focus trap + scroll lock for the checkout modal ---------- */
  var CourseUI = {
    $: $,
    $$: $$,
    formatInr: formatInr,
    lastFocused: null,

    openModal: function (modal) {
      if (!modal) return;
      CourseUI.lastFocused = document.activeElement;
      modal.hidden = false;
      modal.classList.add('is-open');
      document.body.classList.add('is-modal-open');
      document.body.style.overflow = 'hidden';
      /* Move focus to the first meaningful control */
      window.setTimeout(function () {
        var first = modal.querySelector('#buyerEmail') ||
                    modal.querySelector('input, button, [href], select, textarea');
        if (first) first.focus();
      }, 60);
    },

    closeModal: function (modal) {
      if (!modal) return;
      modal.classList.remove('is-open');
      modal.hidden = true;
      document.body.classList.remove('is-modal-open');
      document.body.style.overflow = '';
      if (CourseUI.lastFocused && CourseUI.lastFocused.focus) {
        CourseUI.lastFocused.focus();
      }
    },

    trapFocus: function (modal, e) {
      if (!modal || e.key !== 'Tab') return;
      var focusables = modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  };

  window.CourseUI = CourseUI;

  /* --- Boot ------------------------------------------------------------- */
  function boot() {
    applyConfig();
    initHeader();
    initAnchors();
    initReveal();
    initCopyButtons();
    initStickyCta();
  }

  /* config.js is loaded before this file (not deferred), so the DOM may still
     be parsing. DOMContentLoaded covers both orders safely. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
