const deviceKey = 'aqua-alert-new-device';
function token() { return window.AquaAccount.token(); }
function setToken(value) { window.AquaAccount.setToken(value); }
function api(path, options = {}) { return window.AquaAccount.request(path, options); }
function showStatus(message, type = '') {
  const element = document.querySelector('#status');
  if (element) { element.textContent = message; element.className = `status ${type}`; }
}
function showDeviceCredentials(device) {
  const box = document.querySelector('#deviceCredentials');
  if (!box || !device?.api_key) return;
  document.querySelector('#espKey').textContent = device.api_key;
  document.querySelector('#espKey').dataset.short = String(/^\d{5}$/.test(device.api_key));
  if (device.id) { const identifier = document.querySelector('#deviceId') || document.querySelector('#espId'); if (identifier) identifier.textContent = device.id; }
  box.hidden = false;
  box.querySelector('[data-copy="#espKey"]')?.removeAttribute('disabled');


  if (location.pathname.endsWith('dashboard.html')) localStorage.removeItem(deviceKey);
}
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.querySelector(button.dataset.copy).textContent);
      const label = button.textContent; button.textContent = 'Copiado!'; setTimeout(() => { button.textContent = label; }, 1500);
    } catch { showStatus('Não foi possível copiar automaticamente. Selecione a chave para copiar.', 'error'); }
  }));
  await window.AquaAccount.ready;
  if ((location.pathname.endsWith('/') || location.pathname.endsWith('index.html')) && token()) location.replace('dashboard.html');
});
