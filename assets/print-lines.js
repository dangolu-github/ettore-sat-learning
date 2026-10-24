/* Line-preserved text (poems and other text whose line breaks carry meaning) prints one source line per printed line
   (shared print-layout standard, 2026-10-24). A block marked data-print-lines holds one child element per source
   line. Before printing, its widest line is measured and that block alone is shrunk until every line fits, never
   below 7pt; a block too wide even at 7pt keeps wrapping with a hanging indent. Undone after printing.
   Loaded beside booster-practice.js and mistake-log.js. */
(function (global) {
  'use strict';
  if (global.PortalPrintLines) return;
  var PRINT_TEXT_WIDTH = 660;   // A4 at the browser's default margins, minus the question card's padding
  var style = document.createElement('style');
  style.textContent = '[data-print-lines]>*{display:block}' +
    '.print-lines-measure>*{white-space:nowrap!important;font-size:var(--print-measure-size,12px)!important}' +
    '@media print{[data-print-lines]>*{padding-left:1.5em;text-indent:-1.5em}' +
    '@supports (font-size:1cqi){.print-lines-fit{container-type:inline-size}' +
    '.print-lines-fit>*{white-space:nowrap!important;font-size:max(7pt,min(1em,calc(98cqi / var(--print-line-em))))!important}}}';
  (document.head || document.documentElement).appendChild(style);

  var fitted = [];

  // Measured at 12px, then again near the printed size: system fonts change letter spacing with size.
  function prepare() {
    restore();
    Array.prototype.forEach.call(document.querySelectorAll('[data-print-lines]'), function (block) {
      var lines = Array.prototype.slice.call(block.children);
      if (!lines.length || !block.getClientRects().length) return;
      block.classList.add('print-lines-measure');
      var widestAt = function (px) {
        block.style.setProperty('--print-measure-size', px + 'px');
        return Math.max.apply(null, lines.map(function (line) {
          var range = document.createRange();
          range.selectNodeContents(line);
          return range.getBoundingClientRect().width / px;
        }));
      };
      var em = widestAt(12);
      if (em > 0) em = Math.max(em, widestAt(Math.min(13.6, PRINT_TEXT_WIDTH / em)));
      block.classList.remove('print-lines-measure');
      block.style.removeProperty('--print-measure-size');
      if (em > 0 && em <= 72) {   // above 72em even 7pt overflows the page: leave it wrapping
        block.style.setProperty('--print-line-em', em.toFixed(2));
        block.classList.add('print-lines-fit');
        fitted.push(block);
      }
    });
  }

  function restore() {
    fitted.forEach(function (block) {
      block.classList.remove('print-lines-fit');
      block.style.removeProperty('--print-line-em');
    });
    fitted = [];
  }

  global.addEventListener('beforeprint', prepare);
  global.addEventListener('afterprint', restore);
  global.PortalPrintLines = { prepare: prepare, restore: restore };
})(window);
