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
  box.hidden = false;
  box.querySelector('[data-copy]')?.removeAttribute('disabled');
  document.querySelector('#newKeyNotice')?.removeAttribute('hidden');
  const settings = document.querySelector('.device-settings');
  if (settings) settings.open = true;
  if (location.pathname.endsWith('dashboard.html')) localStorage.removeItem(deviceKey);
}
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.querySelector(button.dataset.copy).textContent);
      button.textContent = 'Copiado!'; setTimeout(() => { button.textContent = 'Copiar'; }, 1500);
    } catch { showStatus('Não foi possível copiar automaticamente. Selecione a chave para copiar.', 'error'); }
  }));
  await window.AquaAccount.ready;
  if ((location.pathname.endsWith('/') || location.pathname.endsWith('index.html')) && token()) location.replace('dashboard.html');
});
