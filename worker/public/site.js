// Static-link size picker and copy buttons. Loaded as an external file: the CSP
// allows no inline script. Messages come from the page (data-* on #copy-status),
// so this file has no language of its own.
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

  // One live region for every copy button. The button keeps its own label;
  // the result is announced here and shown on the button as a check icon.
  const status = document.getElementById('copy-status');
  let timer;
  const report = (btn, key) => {
    clearTimeout(timer);
    for (const o of document.querySelectorAll('button.copy[data-done]')) delete o.dataset.done;
    if (key === 'copied') btn.dataset.done = '';
    if (status) status.textContent = status.dataset[key] ?? '';
    // Clear it after a while so no stale "copied" is left for screen-reader browse mode.
    timer = setTimeout(() => {
      delete btn.dataset.done;
      if (status) status.textContent = '';
    }, 2000);
  };

  for (const btn of document.querySelectorAll('button.copy')) {
    btn.addEventListener('click', async () => {
      const code = document.getElementById(btn.dataset.target);
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent);
        report(btn, 'copied');
      } catch {
        // No clipboard (http, old browser): select the text so it can be copied by hand.
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
        report(btn, 'failed');
      }
    });
  }
})();
