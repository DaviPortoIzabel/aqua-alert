(() => {
  const $ = selector => document.querySelector(selector);
  function mode(value, focus = false) {
    $('#authMain').hidden = false; $('#passwordRecovery').hidden = true;
    ['login', 'register'].forEach(name => {
      const active = name === value; $(`#${name}Panel`).hidden = !active;
      $(`#${name}Tab`).setAttribute('aria-selected', String(active)); $(`#${name}Tab`).tabIndex = active ? 0 : -1;
    });
    showStatus(''); if (focus) $(`#${value === 'login' ? 'loginEmail' : 'registerName'}`).focus();
  }
  async function submit(form, message, action) {
    const buttons = form.querySelectorAll('button'); buttons.forEach(button => { button.disabled = true; }); form.setAttribute('aria-busy', 'true'); showStatus(message);
    try { await action(); } catch (error) { showStatus(error.message, 'error'); }
    finally { buttons.forEach(button => { button.disabled = false; }); form.setAttribute('aria-busy', 'false'); }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    await window.AquaAccount.ready; if (token()) { location.replace('dashboard.html'); return; }
    ['login', 'register'].forEach(name => $(`#${name}Tab`).addEventListener('click', () => mode(name)));
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => mode(button.dataset.authMode, true)));
    $('.auth-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
      const target = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : $('#loginTab').getAttribute('aria-selected') === 'true' ? 'register' : 'login'; mode(target); $(`#${target}Tab`).focus();
    });
    document.querySelectorAll('[data-password]').forEach(button => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.password); const visible = input.type === 'password'; input.type = visible ? 'text' : 'password'; button.textContent = visible ? 'Ocultar' : 'Mostrar'; button.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha'); button.setAttribute('aria-pressed', String(visible));
    }));
    $('#loginForm').addEventListener('submit', event => { event.preventDefault(); submit(event.target, 'Entrando no seu painel…', async () => {
      const data = await api('/api/auth/login', { session: false, method: 'POST', body: JSON.stringify({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value }) }); setToken(data.token); location.assign('dashboard.html');
    }); });
    $('#registerForm').addEventListener('submit', event => {
      event.preventDefault(); if ($('#registerPassword').value !== $('#registerConfirmation').value) { showStatus('As senhas precisam ser iguais. Confira a confirmação.', 'error'); $('#registerConfirmation').focus(); return; }
      submit(event.target, 'Criando sua conta…', async () => {
        const data = await api('/api/auth/register', { session: false, method: 'POST', body: JSON.stringify({ name: $('#registerName').value.trim(), email: $('#registerEmail').value.trim(), password: $('#registerPassword').value }) });
        setToken(data.token); window.AquaAccount.refresh();
        try { localStorage.removeItem(deviceKey); } catch {}
        $('#authMain').hidden = true; $('#passwordRecovery').hidden = true; showStatus(''); showDeviceCredentials(data.device); $('#deviceCredentials h2').tabIndex = -1; $('#deviceCredentials h2').focus();
      });
    });
    $('#forgotPasswordButton').addEventListener('click', () => { $('#authMain').hidden = true; $('#passwordRecovery').hidden = false; $('#forgotForm').hidden = false; $('#resetForm').hidden = true; $('#forgotEmail').value = $('#loginEmail').value; showStatus(''); $('#forgotEmail').focus(); });
    $('#forgotForm').addEventListener('submit', event => { event.preventDefault(); submit(event.target, 'Solicitando código de verificação…', async () => {
      const email = $('#forgotEmail').value.trim(); const data = await api('/api/auth/forgot-password', { session: false, method: 'POST', body: JSON.stringify({ email }) });
      $('#resetEmail').value = email; $('#forgotForm').hidden = true; $('#resetForm').hidden = false; $('#recoveryStep').textContent = 'RECUPERAR ACESSO · 2 DE 2'; $('#recoveryDescription').textContent = 'Se o e-mail estiver cadastrado, você receberá um código. Digite os seis números e escolha uma nova senha.'; showStatus(data.message); $('#resetCode').focus();
    }); });
    $('#resetForm').addEventListener('submit', event => { event.preventDefault(); submit(event.target, 'Salvando a nova senha…', async () => {
      const data = await api('/api/auth/reset-password', { session: false, method: 'POST', body: JSON.stringify({ email: $('#resetEmail').value, code: $('#resetCode').value, password: $('#resetPassword').value }) }); mode('login'); $('#loginEmail').value = $('#resetEmail').value; $('#loginPassword').value = ''; $('#resetForm').reset(); showStatus(data.message, 'success'); $('#loginPassword').focus();
    }); });
    function recoveryStart() { $('#forgotForm').hidden = false; $('#resetForm').hidden = true; $('#recoveryStep').textContent = 'RECUPERAR ACESSO · 1 DE 2'; $('#recoveryDescription').textContent = 'Informe o e-mail da sua conta. Enviaremos um código válido por 15 minutos.'; showStatus(''); $('#forgotEmail').focus(); }
    $('#resendCode').addEventListener('click', recoveryStart);
    $('#backToLogin').addEventListener('click', () => { recoveryStart(); mode('login', true); });
  });
})();
