/* ==========================================================================
   js/faq.js — accessible FAQ accordion (5 questions)
   - <button aria-expanded aria-controls> + region panel
   - One panel open at a time
   - Works without JS too: index.html keeps the first answer's markup readable
     and this script only manages visibility once it loads.
   ========================================================================== */
(function () {
  'use strict';

  function initFaq() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.faq-item'));
    if (!items.length) return;

    items.forEach(function (item) {
      var btn = item.querySelector('.faq-q');
      var panel = item.querySelector('.faq-a');
      if (!btn || !panel) return;

      /* Start closed and keep ARIA in sync with the markup */
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');

      btn.addEventListener('click', function () {
        var isOpen = btn.getAttribute('aria-expanded') === 'true';

        /* Close every other panel (single-open accordion) */
        items.forEach(function (other) {
          if (other === item) return;
          var ob = other.querySelector('.faq-q');
          var op = other.querySelector('.faq-a');
          if (!ob || !op) return;
          ob.setAttribute('aria-expanded', 'false');
          op.hidden = true;
        });

        /* Toggle this one */
        btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        panel.hidden = isOpen;
      });
    });

    /* Keyboard nicety: Up/Down arrows move between question buttons */
    items.forEach(function (item, index) {
      var btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowDown') next = items[(index + 1) % items.length];
        else if (e.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
        if (next) {
          e.preventDefault();
          var nb = next.querySelector('.faq-q');
          if (nb) nb.focus();
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFaq);
  } else {
    initFaq();
  }
})();
