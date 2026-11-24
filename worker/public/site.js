// Static-link size picker and copy buttons. Loaded as an external file: the CSP
// allows no inline script.
(() => {
  const suffix = { thumb: '.thumb.jpg', main: '.jpg', full: '.full.jpg' };
  const sizes = document.querySelectorAll('.sizes button');
  for (const b of sizes) {
    b.addEventListener('click', () => {
      for (const o of sizes) o.setAttribute('aria-pressed', String(o === b));
      for (const c of document.querySelectorAll('code[data-base]')) {
        c.textContent = c.dataset.base + suffix[b.dataset.size];
      }
    });
  }
  for (const btn of document.querySelectorAll('button.copy')) {
    btn.addEventListener('click', async () => {
      const code = document.getElementById(btn.dataset.target);
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent);
        btn.dataset.done = '';
        btn.setAttribute('aria-label', 'Copiado');
        setTimeout(() => { delete btn.dataset.done; btn.setAttribute('aria-label', 'Copiar link'); }, 1500);
      } catch {
        // No clipboard (http, old browser): select the text so it can be copied by hand.
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }
    });
  }
})();
