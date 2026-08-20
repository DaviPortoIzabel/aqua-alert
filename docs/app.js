const API_BASE = "https://aqua-alert-api.davipizabel.workers.dev";
const tokenKey = "aqua-alert-token";
const deviceKey = "aqua-alert-new-device";

function token() { return localStorage.getItem(tokenKey); }
function setToken(value) { localStorage.setItem(tokenKey, value); }
function logout() { localStorage.removeItem(tokenKey); localStorage.removeItem(deviceKey); window.location.href = "auth.html"; }
function showStatus(message, type = "") { const element = document.querySelector("#status"); if (element) { element.textContent = message; element.className = `status ${type}`; } }
async function api(path, options = {}) {
  const requestHeaders = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token()) requestHeaders.Authorization = `Bearer ${token()}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: requestHeaders });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { localStorage.removeItem(tokenKey); if (!location.pathname.endsWith("auth.html")) location.href = "auth.html"; }
  if (!response.ok) throw new Error(body.error || "Não foi possível concluir a operação.");
  return body;
}

function showDeviceCredentials(device) {
  const box = document.querySelector("#deviceCredentials");
  if (!box || !device?.api_key) return;
  document.querySelector("#espCode").textContent = device.id;
  document.querySelector("#espKey").textContent = device.api_key;
  box.hidden = false;
  localStorage.removeItem(deviceKey);
}

function installCopyButtons() {
  document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.querySelector(button.dataset.copy).textContent);
    button.textContent = "Copiado!"; setTimeout(() => { button.textContent = "Copiar"; }, 1500);
  }));
}

let dailyChart; let weeklyChart;
function renderChart(current, canvasId, labels, values, color) {
  if (current) current.destroy();
  return new Chart(document.querySelector(canvasId), { type: "bar", data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: "Litros" } } } } });
}
function renderHistory(rows) {
  const tbody = document.querySelector("#historyBody"); tbody.innerHTML = "";
  if (!rows.length) { tbody.innerHTML = '<tr><td class="empty" colspan="4">Ainda não há leituras enviadas pelo seu ESP.</td></tr>'; return; }
  rows.forEach((row) => { const tr = document.createElement("tr"); [row.dia, row.device_id, `${Number(row.total_litros).toFixed(2)} L`, Number(row.total_litros) > 100 ? "Alto consumo" : "Normal"].forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.append(td); }); tbody.append(tr); });
}
async function refreshDashboard() {
  showStatus("Atualizando dados…");
  try {
    const [profile, today, daily, weekly, history] = await Promise.all([api("/api/me"), api("/api/consumo/hoje"), api("/api/consumo/diario"), api("/api/consumo/semanal"), api("/api/historico")]);
    document.querySelector("#todayUsage").textContent = `${Number(today.total_litros).toFixed(2)} L`;
    document.querySelector("#deviceName").textContent = profile.device.id;
    document.querySelector("#userName").textContent = profile.user.name;
    document.querySelector("#espCode").textContent = profile.device.id;
    const credentials = document.querySelector("#deviceCredentials");
    credentials.hidden = false;
    if (!document.querySelector("#espKey").textContent) document.querySelector("#espKey").textContent = "Gere uma nova chave apenas se precisar reconfigurar o ESP.";
    dailyChart = renderChart(dailyChart, "#dailyChart", daily.labels, daily.valores, "rgba(56,189,248,.72)"); weeklyChart = renderChart(weeklyChart, "#weeklyChart", weekly.labels, weekly.valores, "rgba(27,108,168,.72)"); renderHistory(history); showStatus("Dados atualizados.", "success");
  } catch (error) { showStatus(error.message, "error"); }
}

document.addEventListener("DOMContentLoaded", () => {
  installCopyButtons();
  if (location.pathname.endsWith("auth.html")) {
    if (token()) { location.href = "dashboard.html"; return; }
    document.querySelector("#loginForm").addEventListener("submit", async (event) => { event.preventDefault(); showStatus("Entrando…"); try { const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: document.querySelector("#loginEmail").value, password: document.querySelector("#loginPassword").value }) }); setToken(data.token); location.href = "dashboard.html"; } catch (error) { showStatus(error.message, "error"); } });
    document.querySelector("#registerForm").addEventListener("submit", async (event) => { event.preventDefault(); showStatus("Criando sua conta…"); try { const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ name: document.querySelector("#registerName").value, email: document.querySelector("#registerEmail").value, password: document.querySelector("#registerPassword").value }) }); setToken(data.token); localStorage.setItem(deviceKey, JSON.stringify(data.device)); showDeviceCredentials(data.device); } catch (error) { showStatus(error.message, "error"); } });
    return;
  }
  if (!token()) { location.href = "auth.html"; return; }
  document.querySelector("#refreshButton").addEventListener("click", refreshDashboard); document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#rotateKeyButton").addEventListener("click", async () => { if (!confirm("Gerar uma nova chave? O ESP antigo deixará de enviar dados até ser atualizado.")) return; try { const data = await api("/api/dispositivos/chave", { method: "POST" }); showDeviceCredentials(data.device); } catch (error) { showStatus(error.message, "error"); } });
  try { const pending = JSON.parse(localStorage.getItem(deviceKey) || "null"); if (pending) showDeviceCredentials(pending); } catch { /* sem credencial pendente */ }
  refreshDashboard();
});
