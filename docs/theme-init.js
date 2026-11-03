(() => {
  let preference = 'system';
  try { preference = localStorage.getItem('aqua-alert-theme') || 'system'; } catch { /* Use device theme if storage is unavailable. */ }
  document.documentElement.dataset.theme = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
})();
