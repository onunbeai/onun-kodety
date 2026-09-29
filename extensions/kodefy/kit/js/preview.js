(function () {
  'use strict';
  document.querySelectorAll('[data-preview-year]').forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });
}());
