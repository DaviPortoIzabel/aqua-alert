const storageKey = "aqua-alert-settings";
const defaults = { apiUrl: "https://aqua-alert-api.davipizabel.workers.dev", dashboardKey: "", deviceId: "aqua-001" };

function loadSettings() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; }
  catch { return { ...defaults }; }
}

function saveSettings(settings) { localStorage.setItem(storageKey, JSON.stringify(settings)); }

function setStatus(message, type = "") {
  const element = document.querySelector("#apiStatus");
  element.textContent = message;
  element.className = `status ${type}`;
}

function apiUrl(path) {
  const { apiUrl: base, deviceId } = loadSettings();
  if (!base) throw new Error("Informe a URL da API Cloudflare antes de carregar o painel.");
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("device_id", deviceId);
  return url;
}

async function request(path) {
  const { dashboardKey } = loadSettings();
  if (!dashboardKey) throw new Error("Informe a chave de acesso do painel.");
  const response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${dashboardKey}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "A API não respondeu corretamente.");
  return body;
}

let dailyChart;
let weeklyChart;

function renderChart(current, canvasId, labels, values, color) {
  if (current) current.destroy();
  return new Chart(document.querySelector(canvasId), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: "Litros" } } } },
  });
}

function renderHistory(rows) {
  const tbody = document.querySelector("#historyBody");
  tbody.innerHTML = "";
  if (!rows.length) { tbody.innerHTML = '<tr><td class="empty" colspan="4">Ainda não há leituras para este dispositivo.</td></tr>'; return; }
  rows.forEach((row) => {
    const status = Number(row.total_litros) > 100 ? "Alto consumo" : "Normal";
    const tr = document.createElement("tr");
    [row.dia, row.device_id, `${Number(row.total_litros).toFixed(2)} L`, status].forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
    tbody.append(tr);
  });
}

async function refreshDashboard() {
  setStatus("Atualizando dados…");
  try {
    const [today, daily, weekly, history] = await Promise.all([
      request("/api/consumo/hoje"), request("/api/consumo/diario"), request("/api/consumo/semanal"), request("/api/historico"),
    ]);
    document.querySelector("#todayUsage").textContent = `${Number(today.total_litros).toFixed(2)} L`;
    document.querySelector("#deviceName").textContent = today.device_id;
    dailyChart = renderChart(dailyChart, "#dailyChart", daily.labels, daily.valores, "rgba(56,189,248,.72)");
    weeklyChart = renderChart(weeklyChart, "#weeklyChart", weekly.labels, weekly.valores, "rgba(27,108,168,.72)");
    renderHistory(history);
    setStatus("Dados atualizados.", "success");
  } catch (error) { setStatus(error.message, "error"); }
}

document.addEventListener("DOMContentLoaded", () => {
  const settings = loadSettings();
  document.querySelector("#apiUrl").value = settings.apiUrl;
  document.querySelector("#dashboardKey").value = settings.dashboardKey;
  document.querySelector("#deviceId").value = settings.deviceId;
  document.querySelector("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const apiUrlValue = document.querySelector("#apiUrl").value.trim();
    try { new URL(apiUrlValue); } catch { setStatus("A URL da API é inválida.", "error"); return; }
    saveSettings({ apiUrl: apiUrlValue, dashboardKey: document.querySelector("#dashboardKey").value.trim(), deviceId: document.querySelector("#deviceId").value.trim() });
    refreshDashboard();
  });
  document.querySelector("#refreshButton").addEventListener("click", refreshDashboard);
  if (settings.apiUrl && settings.dashboardKey) refreshDashboard();
});
