(() => {
  'use strict';
  const BASE = 'https://aqua-alert-api.davipizabel.workers.dev';
  const TOKEN = 'aqua-alert-token';
  const PROFILE = 'aqua-alert-profile';
  const THEME = 'aqua-alert-theme';
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* The server remains the source of truth. */ } };
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let profile = null;
  let settingsAvailable = false;
  let menu;
  let dialog;
  let upload = null;
  let returnFocus;
  let busy = false;

  function applyTheme(value) {
    const choice = ['light', 'dark', 'system'].includes(value) ? value : 'system';
    document.documentElement.dataset.theme = choice === 'system' ? (systemTheme.matches ? 'dark' : 'light') : choice;
    write(THEME, choice);
    document.dispatchEvent(new Event('aqua-theme-change'));
  }
  systemTheme.addEventListener('change', () => { if ((read(THEME) || 'system') === 'system') applyTheme('system'); });
  function clearSession() {
    write(TOKEN, null); write(PROFILE, null); write('aqua-alert-new-device', null);
    profile = null;
    renderNavigation();
  }
  async function request(path, options = {}) {
    const { session = true, ...fetchOptions } = options;
    const headers = { 'Content-Type': 'application/json', ...fetchOptions.headers };
    if (session && read(TOKEN)) headers.Authorization = `Bearer ${read(TOKEN)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try { response = await fetch(`${BASE}${path}`, { ...fetchOptions, headers, signal: controller.signal }); }
    catch { throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.'); }
    finally { clearTimeout(timer); }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && session) {
      clearSession();
      if (location.pathname.endsWith('dashboard.html')) location.replace('auth.html');
    }
    if (!response.ok) {
      const error = new Error(response.status === 404 && path.startsWith('/api/account') ? 'As configurações da conta ainda não estão disponíveis no servidor. Tente novamente mais tarde.' : body.error || 'Não foi possível concluir. Tente novamente.');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function logout() { clearSession(); location.assign('auth.html'); }
  function avatar(element, user) {
    element.replaceChildren();
    if (user?.avatar) {
      const img = document.createElement('img');
      img.src = user.avatar; img.alt = ''; img.width = 40; img.height = 40;
      element.append(img);
    } else element.textContent = (user?.name || 'A').trim().slice(0, 1).toLocaleUpperCase('pt-BR');
  }
  function closeMenu(focus = false) {
    if (!menu) return;
    menu.querySelector('.account-panel').hidden = true;
    menu.querySelector('.account-trigger').setAttribute('aria-expanded', 'false');
    if (focus) menu.querySelector('.account-trigger').focus();
  }
  function renderNavigation() {
    const logged = Boolean(read(TOKEN));
    const dashboard = location.pathname.endsWith('dashboard.html');
    const homePage = location.pathname.endsWith('/') || location.pathname.endsWith('index.html');
    const home = document.querySelector('.nav-links a');
    if (home) {
      home.textContent = logged ? 'Dashboard' : 'Home'; home.href = logged ? 'dashboard.html' : 'index.html';
      home.removeAttribute('aria-current');
      if (logged ? dashboard : homePage) home.setAttribute('aria-current', 'page');
    }
    const brand = document.querySelector('.logo a');
    if (brand) brand.href = logged ? 'dashboard.html' : 'index.html';
    const cta = document.querySelector('.nav-cta');
    if (!cta) return;
    if (!logged) {
      cta.innerHTML = '<a href="auth.html">Entrar</a>'; menu = null; return;
    }
    if (!menu || !menu.isConnected) {
      cta.innerHTML = `<div class="account-control"><button type="button" class="account-trigger" aria-label="Abrir opções da conta" aria-expanded="false" aria-controls="account-panel"><span class="account-avatar" aria-hidden="true"></span></button><section class="account-panel" id="account-panel" aria-label="Minha conta" hidden><div class="account-identity"><span class="account-avatar" aria-hidden="true"></span><div><strong id="account-name"></strong><span id="account-email"></span></div></div><p class="account-notice" role="status"></p><label class="theme-label" for="account-theme">Aparência<select id="account-theme"><option value="system">Usar tema do dispositivo</option><option value="light">Tema claro</option><option value="dark">Tema escuro</option></select></label><button type="button" data-account="photo">Alterar foto de perfil</button><button type="button" data-account="password">Alterar senha</button><a href="dashboard.html">Meu dashboard</a><button type="button" class="account-signout" data-account="logout">Sair da conta</button></section></div>`;
      menu = cta.querySelector('.account-control');
      const trigger = menu.querySelector('.account-trigger');
      trigger.addEventListener('click', () => {
        const panel = menu.querySelector('.account-panel'); panel.hidden = !panel.hidden;
        trigger.setAttribute('aria-expanded', String(!panel.hidden));
      });
      menu.querySelector('[data-account="logout"]').addEventListener('click', logout);
      menu.querySelector('[data-account="photo"]').addEventListener('click', () => openSettings('photo'));
      menu.querySelector('[data-account="password"]').addEventListener('click', () => openSettings('password'));
      menu.querySelector('select').addEventListener('change', saveTheme);
    }
    menu.querySelector('#account-name').textContent = profile?.name || 'Minha conta';
    menu.querySelector('#account-email').textContent = profile?.email || 'Carregando perfil…';
    menu.querySelectorAll('.account-avatar').forEach((element) => avatar(element, profile));
    menu.querySelector('select').value = read(THEME) || 'system';
    menu.querySelectorAll('[data-account="photo"], [data-account="password"]').forEach((button) => {
      button.disabled = !settingsAvailable;
      button.title = settingsAvailable ? '' : 'Configurações de perfil temporariamente indisponíveis';
    });
    if (profile && !settingsAvailable) menu.querySelector('.account-notice').textContent = 'Foto e alteração de senha estão temporariamente indisponíveis.';
  }
  async function refresh() {
    if (!read(TOKEN)) { renderNavigation(); return null; }
    try {
      const result = await request('/api/me');
      profile = result.user;
      settingsAvailable = Object.hasOwn(profile, "avatar") && Object.hasOwn(profile, "theme");
      write(PROFILE, JSON.stringify(profile));
      // Older API versions do not expose a saved preference.
      if (profile.theme) applyTheme(profile.theme);
      renderNavigation();
      return profile;
    } catch (error) {
      renderNavigation();
      if (menu) menu.querySelector('.account-notice').textContent = error.status === 401 ? 'Sua sessão expirou.' : 'Não foi possível atualizar o perfil. Tente novamente.';
      return null;
    }
  }
  async function saveTheme(event) {
    const select = event.target;
    applyTheme(select.value);
    if (!settingsAvailable) {
      menu.querySelector('.account-notice').textContent = 'Tema aplicado neste navegador. A sincronização da conta está temporariamente indisponível.';
      return;
    }
    select.disabled = true;
    try {
      await request('/api/account', { method: 'POST', body: JSON.stringify({ theme: select.value }) });
      if (profile) { profile.theme = select.value; write(PROFILE, JSON.stringify(profile)); }
      menu.querySelector('.account-notice').textContent = 'Tema salvo na sua conta.';
    } catch (error) {
      // Theme works locally even while an older API is being updated.
      if (menu) menu.querySelector('.account-notice').textContent = 'Tema aplicado neste navegador. Não foi possível sincronizar com a conta.';
    } finally { select.disabled = false; }
  }
  function notice(message, error = false) {
    const element = dialog.querySelector('.account-form-status');
    element.textContent = message; element.classList.toggle('error', error);
  }
  function setBusy(value) {
    busy = value;
    dialog.querySelectorAll('button,input').forEach((element) => { element.disabled = value; });
    dialog.setAttribute('aria-busy', String(value));
  }
  function closeSettings() {
    if (busy) return;
    dialog.close(); returnFocus?.focus();
  }
  function openSettings(type) {
    if (!read(TOKEN)) return;
    returnFocus = menu.querySelector('.account-trigger'); closeMenu();
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'account-dialog';
      dialog.setAttribute('aria-labelledby', 'account-dialog-title'); document.body.append(dialog);
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeSettings(); });
      dialog.addEventListener('close', () => { dialog.replaceChildren(); upload = null; });
    }
    upload = null;
    const content = type === 'photo' ? `<div class="avatar-preview" aria-label="Prévia da foto"></div><p>Escolha uma imagem JPG, PNG ou WebP de até 5 MB. Ela será recortada ao centro e salva na sua conta.</p><label class="account-field">Escolher imagem<input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp"></label><div class="account-dialog-actions"><button type="button" id="remove-avatar" class="account-secondary">Remover foto</button><button type="submit" id="save-avatar" disabled>Salvar foto</button></div>` : `<label class="account-field">Senha atual<input name="current_password" type="password" autocomplete="current-password" required maxlength="128"></label><label class="account-field">Nova senha<input name="new_password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><label class="account-field">Confirmar nova senha<input name="confirmation" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><p>Use entre 8 e 128 caracteres. As outras sessões serão encerradas após a alteração.</p><button type="submit">Salvar nova senha</button>`;
    dialog.innerHTML = `<div class="account-dialog-heading"><div><p class="account-eyebrow">Minha conta</p><h2 id="account-dialog-title">${type === 'photo' ? 'Sua foto de perfil' : 'Alterar senha'}</h2></div><button type="button" class="account-close" aria-label="Fechar configurações">×</button></div><form>${content}<p class="account-form-status" role="status" aria-live="polite"></p></form>`;
    dialog.querySelector('.account-close').addEventListener('click', closeSettings);
    if (type === 'photo') {
      avatar(dialog.querySelector('.avatar-preview'), profile);
      dialog.querySelector('#avatar-file').addEventListener('change', preparePhoto);
      dialog.querySelector('#remove-avatar').addEventListener('click', () => savePhoto(null));
      dialog.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); if (upload) savePhoto(upload); });
    } else dialog.querySelector('form').addEventListener('submit', savePassword);
    dialog.showModal();
  }
  async function preparePhoto(event) {
    const file = event.target.files[0]; upload = null;
    dialog.querySelector('#save-avatar').disabled = true;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { notice('Escolha uma imagem JPG, PNG ou WebP de até 5 MB.', true); return; }
    setBusy(true);
    try {
      const image = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
      const context = canvas.getContext('2d');
      context.fillStyle = '#e2edf6'; context.fillRect(0, 0, 192, 192);
      const size = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 192, 192);
      image.close();
      upload = canvas.toDataURL('image/jpeg', 0.85);
      avatar(dialog.querySelector('.avatar-preview'), { avatar: upload });
      notice('Prévia pronta. Clique em Salvar foto para guardar na sua conta.');
    } catch { notice('Não foi possível abrir essa imagem. Escolha outro arquivo.', true); }
    finally { setBusy(false); dialog.querySelector('#save-avatar').disabled = !upload; }
  }
  async function savePhoto(value) {
    setBusy(true); notice('Salvando foto…');
    try {
      await request('/api/account', { method: 'POST', body: JSON.stringify({ avatar: value }) });
      if (profile) { profile.avatar = value; write(PROFILE, JSON.stringify(profile)); }
      renderNavigation(); avatar(dialog.querySelector('.avatar-preview'), profile);
      upload = null; notice(value ? 'Foto salva na sua conta.' : 'Foto removida da sua conta.');
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); dialog.querySelector('#save-avatar').disabled = !upload; }
  }
  async function savePassword(event) {
    event.preventDefault(); const form = event.target; const data = new FormData(form);
    if (data.get('new_password') !== data.get('confirmation')) { notice('A confirmação precisa ser igual à nova senha.', true); return; }
    setBusy(true); notice('Alterando senha…');
    try {
      const result = await request('/api/account/password', { method: 'POST', body: JSON.stringify({ current_password: data.get('current_password'), new_password: data.get('new_password') }) });
      write(TOKEN, result.token); form.reset(); notice(result.message);
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); }
  }
  document.addEventListener('click', (event) => { if (menu && !menu.contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu && menu.querySelector('.account-trigger').getAttribute('aria-expanded') === 'true') closeMenu(true); });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME) applyTheme(event.newValue);
    if (event.key === TOKEN || event.key === PROFILE) {
      if (!read(TOKEN)) { clearSession(); if (location.pathname.endsWith('dashboard.html')) location.replace('auth.html'); }
      else refresh();
    }
  });
  try { profile = read(TOKEN) ? JSON.parse(read(PROFILE)) : null; } catch { profile = null; }
  settingsAvailable = Boolean(profile && Object.hasOwn(profile, "avatar") && Object.hasOwn(profile, "theme"));
  renderNavigation();
  const ready = refresh();
  window.AquaAccount = { request, ready, refresh, logout, token: () => read(TOKEN), setToken: (value) => { write(TOKEN, value); write(PROFILE, null); profile = null; settingsAvailable = false; renderNavigation(); }, theme: () => document.documentElement.dataset.theme };
})();
