// Theme picker. Loaded in <head> without defer, so data-theme is on <html>
// before the first paint and a dark choice never flashes light. External file:
// the CSP allows no inline script.
// "auto" is no attribute and nothing stored: the CSS follows the OS setting.
(() => {
  const KEY = 'vf-theme';
  const root = document.documentElement;
  const valid = (v) => v === 'light' || v === 'dark';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (valid(saved)) root.dataset.theme = saved;

  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('theme');
    if (!select) return;
    select.value = valid(root.dataset.theme) ? root.dataset.theme : 'auto';
    select.closest('.theme')?.removeAttribute('hidden');
    select.addEventListener('change', () => {
      const v = select.value;
      try {
        if (valid(v)) localStorage.setItem(KEY, v);
        else localStorage.removeItem(KEY);
      } catch { /* the choice still holds for this page */ }
      if (valid(v)) root.dataset.theme = v;
      else delete root.dataset.theme;
    });
  });
})();
