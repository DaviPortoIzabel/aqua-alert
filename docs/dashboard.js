(() => {
  const $ = selector => document.querySelector(selector);
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const liters = value => `${number.format(value)} L`;
  const formatDate = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  const dateKey = date => date.toISOString().slice(0, 10);
  function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function addDays(value, count) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return dateKey(date); }
  function monthsBefore(value, count) {
    const date = new Date(`${value}T12:00:00Z`); const day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - count);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last)); return dateKey(date);
  }
  let chart = null; let result = null; let page = 1; let requestId = 0; let selected = null;
  const pageSize = 15;
  function preset(value) {
    const end = today(); let start = end; let finish = end;
    if (value === '7d') start = addDays(end, -6);
    if (value === '30d') start = addDays(end, -29);
    if (value === '6months') start = addDays(monthsBefore(end, 6), 1);
    if (value === 'thismonth') start = end.slice(0, 7) + '-01';
    if (value === 'lastmonth') { finish = addDays(end.slice(0, 7) + '-01', -1); start = finish.slice(0, 7) + '-01'; }
    if (value !== 'custom') { $('#periodStart').value = start; $('#periodEnd').value = finish; }
  }
  function history() {
    const days = [...result.days].reverse(); const start = (page - 1) * pageSize;
    const body = $('#historyBody'); body.replaceChildren();
    if (!days.length) { const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.className = 'empty'; cell.textContent = 'Sem leituras neste período. Experimente outras datas.'; }
    days.slice(start, start + pageSize).forEach(day => {
      const row = body.insertRow();
      [formatDate(day.date), liters(day.liters), number.format(day.readings), day.last_reading.slice(11, 19)].forEach(value => { row.insertCell().textContent = value; });
    });
    $('#tableCount').textContent = days.length ? `${start + 1}–${Math.min(start + pageSize, days.length)} de ${days.length} dias com leituras` : '0 dias com leituras';
    $('#pageNumber').textContent = `${page} / ${Math.max(1, Math.ceil(days.length / pageSize))}`;
    $('#previousPage').disabled = page <= 1; $('#nextPage').disabled = start + pageSize >= days.length;
  }
  function chartData() {
    const granularity = result.series.granularity;
    const values = new Map(result.series.points.map(point => [point.period, point.liters]));
    const keys = []; let cursor = result.start;
    while (cursor <= result.end) {
      if (granularity === 'hour') for (let hour = 0; hour < 24; hour++) keys.push(`${cursor} ${String(hour).padStart(2, '0')}:00`);
      else { const key = granularity === 'month' ? cursor.slice(0, 7) : cursor; if (keys.at(-1) !== key) keys.push(key); }
      cursor = addDays(cursor, 1);
    }
    const labels = keys.map(key => {
      if (granularity === 'hour') return (result.calendar_days > 1 ? key.slice(8, 10) + '/' + key.slice(5, 7) + ' · ' : '') + key.slice(11);
      if (granularity === 'month') return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(key + '-01T12:00:00Z'));
      return key.slice(8, 10) + '/' + key.slice(5, 7);
    });
    return { granularity, keys, labels, values: keys.map(key => values.has(key) ? Math.round(values.get(key) * 1000) / 1000 : null) };
  }
  function drawChart() {
    if (!result) return;
    if (chart) { chart.destroy(); chart = null; }
    const empty = !result.days.length;
    if (empty) $('#chartEmpty').innerHTML = 'Nenhuma leitura neste período.<span>Escolha outras datas ou confira a conexão do seu dispositivo.</span>';
    $('#chartEmpty').hidden = !empty; $('#consumptionChart').hidden = empty;
    const data = chartData();
    $('#chartDescription').textContent = ({ hour: 'Totais por hora · horário de São Paulo', day: 'Totais diários dentro das datas selecionadas', month: 'Totais mensais dentro das datas selecionadas' })[data.granularity];
    $('.chart-footer span:last-child').textContent = ({ hour: 'Horas sem leituras ficam sem valor no gráfico.', day: 'Dias sem leituras ficam sem valor no gráfico.', month: 'Meses sem leituras ficam sem valor no gráfico.' })[data.granularity];
    if (empty) return;
    if (typeof Chart === 'undefined') { $('#consumptionChart').hidden = true; $('#chartEmpty').hidden = false; $('#chartEmpty').textContent = 'Gráfico indisponível. Consulte os valores na tabela abaixo.'; return; }
    const dark = window.AquaAccount.theme() === 'dark';
    const context = $('#consumptionChart').getContext('2d'); const gradient = context.createLinearGradient(0, 0, 0, 310);
    gradient.addColorStop(0, dark ? 'rgba(113,174,218,.27)' : 'rgba(65,130,178,.19)'); gradient.addColorStop(1, 'rgba(65,130,178,0)');
    const style = $('#chartStyle').value;
    chart = new Chart(context, { type: style === 'bar' ? 'bar' : 'line', data: { labels: data.labels, datasets: [{ label: 'Consumo', data: data.values, borderColor: dark ? '#8dc0e5' : '#3e7da9', backgroundColor: style === 'bar' ? (dark ? '#5787aa' : '#a4c5df') : gradient, fill: style === 'area', borderWidth: 2, tension: style === 'step' ? 0 : .25, stepped: style === 'step', spanGaps: false, pointRadius: data.keys.length > 100 ? 1.5 : 3, pointHoverRadius: 6, borderRadius: 6, maxBarThickness: 50 }] }, options: { responsive: true, maintainAspectRatio: false, animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 }, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => ` ${liters(item.parsed.y)}` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: dark ? '#9bb6ca' : '#7d93a4', maxTicksLimit: 10, maxRotation: 0, font: { size: 10 } } }, y: { beginAtZero: true, border: { display: false }, ticks: { color: dark ? '#9bb6ca' : '#7d93a4', maxTicksLimit: 5, callback: value => `${number.format(value)} L`, font: { size: 10 } }, grid: { color: dark ? '#294253' : '#edf2f6' } } } } });
  }
  function renderLeakAlert(alert) {
    const box = $('#leakAlert'); box.hidden = !alert;
    if (!alert) return;
    const labels = { normal: 'Comparação semanal do consumo', media: 'Possibilidade média de vazamento', alta: 'Possibilidade alta de vazamento' };
    const level = Object.hasOwn(labels, alert.level) ? alert.level : 'normal';
    box.className = `leak-alert ${level}`;
    $('#leakTitle').textContent = labels[level];
    $('#leakDescription').textContent = alert.previous_total > 0
      ? `Últimos 7 dias: ${liters(alert.current_total)}. Nos 7 anteriores: ${liters(alert.previous_total)}.${level !== 'normal' ? ` Aumento de ${number.format(alert.increase_percent)}%. Verifique possíveis vazamentos.` : ''}`
      : `Últimos 7 dias: ${liters(alert.current_total)}. Sem consumo registrado nos 7 anteriores para calcular o aumento.`;
  }
  async function load(start = selected?.start || $('#periodStart').value, end = selected?.end || $('#periodEnd').value) {
    if (!start || !end || start > end || end > today()) { $('#filterError').textContent = 'Escolha datas válidas, em ordem, até hoje.'; return; }
    if ((new Date(end) - new Date(start)) / 86400000 >= 3660) { $('#filterError').textContent = 'Escolha um período de até 10 anos.'; return; }
    const granularity = $('#chartGranularity').value;
    if (granularity === 'hour' && (new Date(end) - new Date(start)) / 86400000 >= 31) { $('#filterError').textContent = 'Por hora está disponível para até 31 dias. Escolha dia, mês ou automático.'; return; }
    const id = ++requestId;
    $('#filterError').textContent = ''; $('#dashboardData').setAttribute('aria-busy', 'true'); $('#applyPeriod').disabled = true; $('#refreshButton').disabled = true;
    showStatus('Consultando seu consumo…');
    try {
      const [profile, data, alert] = await Promise.all([api('/api/me'), api(`/api/consumo/periodo?${new URLSearchParams({ start, end, granularity })}`), api('/api/alertas/vazamento').catch(() => null)]);
      if (id !== requestId) return;
      selected = { start, end, granularity }; result = data; page = 1;
      renderLeakAlert(alert);
      $('#userName').textContent = profile.user.name; $('#deviceName').textContent = profile.device.name;
      $('#periodTotal').textContent = liters(data.summary.total_liters);
      $('#periodAverage').textContent = data.summary.average_liters === null ? '—' : liters(data.summary.average_liters);
      $('#periodPeak').textContent = data.summary.peak ? liters(data.summary.peak.liters) : '—';
      $('#peakDate').textContent = data.summary.peak ? formatDate(data.summary.peak.date) : 'Sem leituras no período';
      $('#selectedRange').textContent = `${formatDate(start)} a ${formatDate(end)}`;
      $('#averageNote').textContent = `Por dia com leituras · ${data.summary.recorded_days} de ${data.calendar_days} dias`;
      $('#readingCount').textContent = `${number.format(data.summary.readings)} leituras registradas`;
      $('#lastUpdated').textContent = 'Atualizado às ' + new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date());
      $('#exportCsv').disabled = !data.days.length; history(); drawChart();
      showStatus(data.days.length ? 'Período atualizado.' : 'Nenhuma leitura encontrada nas datas selecionadas.', data.days.length ? 'success' : '');
    } catch (error) { if (id === requestId) { $('#chartGranularity').value = selected?.granularity || 'auto'; showStatus(error.message + (result ? ' Os dados anteriores continuam identificados pelas datas exibidas.' : ''), 'error'); } }
    finally { if (id === requestId) { $('#dashboardData').setAttribute('aria-busy', 'false'); $('#applyPeriod').disabled = false; $('#refreshButton').disabled = false; } }
  }
  function initializeDeviceAccess() {
    let proof = null; let expiry = 0; let timer; let generation = 0;
    const dialog = $('#devicePasswordDialog');
    function lock() {
      generation++; proof = null; expiry = 0; clearTimeout(timer);
      $('#deviceCredentials').hidden = true; $('#openDevice').setAttribute('aria-expanded', 'false');
      $('#espKey').textContent = ''; $('#deviceId').textContent = '—'; $('[data-copy="#espKey"]').disabled = true;
      $('#newKeyNotice').hidden = true; $('#devicePassword').value = '';
    }
    function closePrompt() { generation++; dialog.close(); $('#devicePassword').value = ''; $('#openDevice').focus(); }
    $('#openDevice').addEventListener('click', () => {
      if (proof) { lock(); return; }
      $('#devicePasswordStatus').textContent = ''; $('#devicePassword').value = ''; dialog.showModal(); $('#devicePassword').focus();
    });
    $('#cancelDeviceAccess').addEventListener('click', closePrompt);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closePrompt(); });
    $('#lockDevice').addEventListener('click', () => { lock(); $('#openDevice').focus(); });
    $('#devicePasswordForm').addEventListener('submit', async event => {
      event.preventDefault(); const id = ++generation; $('#confirmDeviceAccess').disabled = true;
      $('#devicePasswordStatus').textContent = 'Conferindo sua senha…'; $('#devicePasswordStatus').classList.remove('error');
      try {
        const data = await api('/api/dispositivos/acesso', { method: 'POST', body: JSON.stringify({ password: $('#devicePassword').value }) });
        if (id !== generation) return;
        proof = data.access_token; expiry = data.expires_at; dialog.close();
        $('#deviceCredentials').hidden = false; $('#openDevice').setAttribute('aria-expanded', 'true');
        $('#deviceId').textContent = data.device.id;
        $('#deviceAccessNote').textContent = data.device.api_key ? (/^\d{5}$/.test(data.device.api_key) ? '' : 'Esta é sua chave atual. Renove abaixo se quiser trocar por cinco números.') : 'Chave antiga indisponível para consulta. Renove para criar uma chave de cinco números e atualize seu ESP.';
        if (data.device.api_key) showDeviceCredentials(data.device);
        else $('#espKey').textContent = 'Chave antiga indisponível para consulta.';
        timer = setTimeout(lock, Math.max(0, expiry * 1000 - Date.now())); $('#lockDevice').focus();
      } catch (error) { if (id === generation) { $('#devicePasswordStatus').textContent = error.message; $('#devicePasswordStatus').classList.add('error'); } }
      finally { $('#devicePassword').value = ''; $('#confirmDeviceAccess').disabled = false; }
    });
    $('#rotateKeyButton').addEventListener('click', async () => {
      if (!proof || Date.now() >= expiry * 1000) { lock(); $('#openDevice').click(); return; }
      if (!confirm('Renovar para uma chave de 5 números? A anterior deixará de funcionar. Configure o identificador e a nova chave no seu ESP.')) return;
      const id = generation; $('#rotateKeyButton').disabled = true;
      try {
        const data = await api('/api/dispositivos/chave', { method: 'POST', headers: { 'X-Device-Access': proof } });
        if (id !== generation) return;
        showDeviceCredentials(data.device); $('#newKeyNotice').hidden = false;
        $('#deviceAccessNote').textContent = ''; $('#deviceId').textContent = data.device.id;
      } catch (error) { if (error.status === 403) lock(); showStatus(error.message, 'error'); }
      finally { $('#rotateKeyButton').disabled = false; }
    });
    window.addEventListener('pagehide', lock);
    window.addEventListener('storage', event => { if (event.key === 'aqua-alert-token') lock(); });
    // Remove the legacy browser copy; the key is recovered only after password verification.
    try { localStorage.removeItem('aqua-alert-new-device'); } catch {}
    lock();
  }
  document.addEventListener('DOMContentLoaded', async () => {
    await window.AquaAccount.ready; if (!token()) { location.replace('auth.html'); return; }
    $('#periodStart').max = $('#periodEnd').max = today(); preset('7d');
    try { const preference = localStorage.getItem('aqua-alert-chart-style'); if (['area', 'line', 'bar', 'step'].includes(preference)) $('#chartStyle').value = preference; } catch {}
    $('#chartStyle').addEventListener('change', () => { try { localStorage.setItem('aqua-alert-chart-style', $('#chartStyle').value); } catch {} drawChart(); });
    $('#chartGranularity').addEventListener('change', () => { if (selected) load(); });
    $('#periodPreset').addEventListener('change', event => preset(event.target.value));
    ['#periodStart', '#periodEnd'].forEach(selector => $(selector).addEventListener('input', () => { $('#periodPreset').value = 'custom'; }));
    $('#periodForm').addEventListener('submit', event => { event.preventDefault(); load($('#periodStart').value, $('#periodEnd').value); });
    $('#refreshButton').addEventListener('click', () => load());
    $('#previousPage').addEventListener('click', () => { page--; history(); }); $('#nextPage').addEventListener('click', () => { page++; history(); });
    $('#exportCsv').addEventListener('click', () => {
      if (!result?.days.length) return;
      const rows = [['Data', 'Consumo (L)', 'Leituras', 'Última medição (São Paulo)'], ...result.days.map(day => [day.date, String(day.liters).replace('.', ','), day.readings, day.last_reading])];
      const blob = new Blob(['\uFEFF' + rows.map(row => row.join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `aqua-alert-${result.start}-${result.end}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    initializeDeviceAccess();
    await load();
  });
  document.addEventListener('aqua-theme-change', () => { if (result) drawChart(); });
})();
