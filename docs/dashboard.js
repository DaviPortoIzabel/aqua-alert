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
    const monthly = result.calendar_days > 92;
    const values = new Map();
    result.days.forEach(day => { const key = monthly ? day.date.slice(0, 7) : day.date; values.set(key, (values.get(key) || 0) + day.liters); });
    const keys = []; let cursor = result.start;
    while (cursor <= result.end) { const key = monthly ? cursor.slice(0, 7) : cursor; if (keys.at(-1) !== key) keys.push(key); cursor = addDays(cursor, 1); }
    return { monthly, keys, labels: keys.map(key => monthly ? new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(key + '-01T12:00:00Z')) : key.slice(8, 10) + '/' + key.slice(5, 7)), values: keys.map(key => values.has(key) ? Math.round(values.get(key) * 1000) / 1000 : null) };
  }
  function drawChart() {
    if (!result) return;
    if (chart) { chart.destroy(); chart = null; }
    const empty = !result.days.length;
    if (empty) $('#chartEmpty').innerHTML = 'Nenhuma leitura neste período.<span>Escolha outras datas ou confira a conexão do seu dispositivo.</span>';
    $('#chartEmpty').hidden = !empty; $('#consumptionChart').hidden = empty;
    const data = chartData();
    $('#chartDescription').textContent = data.monthly ? 'Totais mensais dentro das datas selecionadas' : 'Totais diários dentro das datas selecionadas';
    $('.chart-footer span:last-child').textContent = data.monthly ? 'Meses sem leituras ficam sem valor no gráfico.' : 'Dias sem leituras ficam sem valor no gráfico.';
    if (empty) return;
    if (typeof Chart === 'undefined') { $('#consumptionChart').hidden = true; $('#chartEmpty').hidden = false; $('#chartEmpty').textContent = 'Gráfico indisponível. Consulte os valores na tabela abaixo.'; return; }
    const dark = window.AquaAccount.theme() === 'dark';
    const context = $('#consumptionChart').getContext('2d'); const gradient = context.createLinearGradient(0, 0, 0, 310);
    gradient.addColorStop(0, dark ? 'rgba(113,174,218,.27)' : 'rgba(65,130,178,.19)'); gradient.addColorStop(1, 'rgba(65,130,178,0)');
    chart = new Chart(context, { type: data.monthly ? 'bar' : 'line', data: { labels: data.labels, datasets: [{ label: 'Consumo', data: data.values, borderColor: dark ? '#8dc0e5' : '#3e7da9', backgroundColor: data.monthly ? (dark ? '#5787aa' : '#a4c5df') : gradient, fill: true, borderWidth: 2, tension: .25, spanGaps: false, pointRadius: data.keys.length > 40 ? 0 : 3, pointHoverRadius: 6, borderRadius: 6, maxBarThickness: 50 }] }, options: { responsive: true, maintainAspectRatio: false, animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 }, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => ` ${liters(item.parsed.y)}` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: dark ? '#9bb6ca' : '#7d93a4', maxTicksLimit: 10, maxRotation: 0, font: { size: 10 } } }, y: { beginAtZero: true, border: { display: false }, ticks: { color: dark ? '#9bb6ca' : '#7d93a4', maxTicksLimit: 5, callback: value => `${number.format(value)} L`, font: { size: 10 } }, grid: { color: dark ? '#294253' : '#edf2f6' } } } } });
  }
  async function load(start = selected?.start || $('#periodStart').value, end = selected?.end || $('#periodEnd').value) {
    if (!start || !end || start > end || end > today()) { $('#filterError').textContent = 'Escolha datas válidas, em ordem, até hoje.'; return; }
    if ((new Date(end) - new Date(start)) / 86400000 >= 3660) { $('#filterError').textContent = 'Escolha um período de até 10 anos.'; return; }
    const id = ++requestId;
    $('#filterError').textContent = ''; $('#dashboardData').setAttribute('aria-busy', 'true'); $('#applyPeriod').disabled = true; $('#refreshButton').disabled = true;
    showStatus('Consultando seu consumo…');
    try {
      const [profile, data] = await Promise.all([api('/api/me'), api(`/api/consumo/periodo?${new URLSearchParams({ start, end })}`)]);
      if (id !== requestId) return;
      selected = { start, end }; result = data; page = 1;
      $('#userName').textContent = profile.user.name; $('#deviceName').textContent = profile.device.name;
      $('#deviceCredentials').hidden = false;
      if (!$('#espKey').textContent) $('#espKey').textContent = 'Chave protegida. Gere uma nova somente se precisar reconfigurar seu ESP.';
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
    } catch (error) { if (id === requestId) showStatus(error.message + (result ? ' Os dados anteriores continuam identificados pelas datas exibidas.' : ''), 'error'); }
    finally { if (id === requestId) { $('#dashboardData').setAttribute('aria-busy', 'false'); $('#applyPeriod').disabled = false; $('#refreshButton').disabled = false; } }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    await window.AquaAccount.ready; if (!token()) { location.replace('auth.html'); return; }
    $('#periodStart').max = $('#periodEnd').max = today(); preset('7d');
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
    $('#rotateKeyButton').addEventListener('click', async () => {
      if (!confirm('Gerar uma nova chave? Você precisará atualizar a configuração do seu ESP.')) return;
      $('#rotateKeyButton').disabled = true;
      try { const data = await api('/api/dispositivos/chave', { method: 'POST' }); showDeviceCredentials(data.device); showStatus('Nova chave gerada. Copie e atualize seu ESP.', 'success'); }
      catch (error) { showStatus(error.message, 'error'); }
      finally { $('#rotateKeyButton').disabled = false; }
    });
    try { const pending = JSON.parse(localStorage.getItem(deviceKey) || 'null'); if (pending) showDeviceCredentials(pending); } catch { /* No pending device key. */ }
    await load();
  });
  document.addEventListener('aqua-theme-change', () => { if (result) drawChart(); });
})();
