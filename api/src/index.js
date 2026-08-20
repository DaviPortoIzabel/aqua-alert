const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device-Key",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function unauthorized() {
  return json({ error: "Não autorizado." }, 401);
}

function sameSecret(received, expected) {
  if (!received || !expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function isDashboardRequest(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return sameSecret(token, env.DASHBOARD_KEY);
}

function isDeviceRequest(request, env) {
  return sameSecret(request.headers.get("X-Device-Key"), env.DEVICE_KEY);
}

function dateKey(date) {
  return saoPauloDateTime(date).slice(0, 10);
}

function saoPauloDateTime(date) {
  // O painel é brasileiro; guardar a data local evita que leituras perto da
  // meia-noite sejam atribuídas ao dia seguinte por causa do UTC.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function validDeviceId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{3,64}$/.test(value);
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function postReading(request, env) {
  if (!isDeviceRequest(request, env)) return unauthorized();
  const body = await parseJson(request);
  if (!body || !validDeviceId(body.device_id)) {
    return json({ error: "device_id inválido." }, 400);
  }

  const flow = body.fluxo ?? body.flow_lpm;
  let liters = body.litros;
  if (liters === undefined && Number.isFinite(Number(flow))) {
    // Compatibilidade com o firmware atual, que envia fluxo a cada 5 segundos.
    const intervalSeconds = Number(body.intervalo_segundos ?? 5);
    liters = (Number(flow) * intervalSeconds) / 60;
  }

  liters = Number(liters);
  if (!Number.isFinite(liters) || liters < 0 || liters > 10000) {
    return json({ error: "litros inválido." }, 400);
  }

  const exists = await env.DB.prepare("SELECT id FROM devices WHERE id = ?")
    .bind(body.device_id)
    .first();
  if (!exists) return json({ error: "Dispositivo não encontrado." }, 404);

  const measuredAt = body.medido_em ? new Date(body.medido_em) : new Date();
  if (Number.isNaN(measuredAt.getTime())) return json({ error: "medido_em inválido." }, 400);
  const measuredAtLocal = saoPauloDateTime(measuredAt);

  await env.DB.prepare(
    "INSERT INTO readings (device_id, measured_at, liters, flow_lpm) VALUES (?, ?, ?, ?)"
  ).bind(body.device_id, measuredAtLocal, liters, Number.isFinite(Number(flow)) ? Number(flow) : null).run();

  return json({ ok: true, device_id: body.device_id, liters, measured_at: measuredAtLocal }, 201);
}

function requestedDevice(url) {
  const id = url.searchParams.get("device_id") || "aqua-001";
  return validDeviceId(id) ? id : null;
}

async function dashboardToday(url, env) {
  const deviceId = requestedDevice(url);
  if (!deviceId) return json({ error: "device_id inválido." }, 400);
  const today = dateKey(new Date());
  const result = await env.DB.prepare(
    "SELECT COALESCE(SUM(liters), 0) AS total_litros FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) = ?"
  ).bind(deviceId, today).first();
  return json({ device_id: deviceId, date: today, total_litros: Number(result.total_litros) });
}

async function dashboardDaily(url, env) {
  const deviceId = requestedDevice(url);
  if (!deviceId) return json({ error: "device_id inválido." }, 400);
  const today = dateKey(new Date());
  const result = await env.DB.prepare(
    "SELECT substr(measured_at, 12, 2) || ':00' AS hora, ROUND(SUM(liters), 3) AS total FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) = ? GROUP BY hora ORDER BY hora"
  ).bind(deviceId, today).all();
  return json({ device_id: deviceId, labels: result.results.map((row) => row.hora), valores: result.results.map((row) => Number(row.total)) });
}

async function dashboardWeekly(url, env) {
  const deviceId = requestedDevice(url);
  if (!deviceId) return json({ error: "device_id inválido." }, 400);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
  const result = await env.DB.prepare(
    "SELECT substr(measured_at, 1, 10) AS dia, ROUND(SUM(liters), 3) AS total FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) >= ? GROUP BY dia ORDER BY dia"
  ).bind(deviceId, dateKey(start)).all();
  return json({ device_id: deviceId, labels: result.results.map((row) => row.dia.slice(8, 10) + "/" + row.dia.slice(5, 7)), valores: result.results.map((row) => Number(row.total)) });
}

async function history(url, env) {
  const deviceId = requestedDevice(url);
  if (!deviceId) return json({ error: "device_id inválido." }, 400);
  const result = await env.DB.prepare(
    "SELECT substr(measured_at, 1, 10) AS dia, device_id, ROUND(SUM(liters), 3) AS total_litros, MAX(measured_at) AS ultima_atualizacao FROM readings WHERE device_id = ? GROUP BY dia, device_id ORDER BY dia DESC LIMIT 90"
  ).bind(deviceId).all();
  return json(result.results);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    if (request.method === "POST" && url.pathname === "/api/leituras") return postReading(request, env);

    // Os dados do painel exigem a chave DASHBOARD_KEY nesta etapa.
    if (url.pathname.startsWith("/api/") && !isDashboardRequest(request, env)) return unauthorized();
    if (request.method === "GET" && url.pathname === "/api/consumo/hoje") return dashboardToday(url, env);
    if (request.method === "GET" && url.pathname === "/api/consumo/diario") return dashboardDaily(url, env);
    if (request.method === "GET" && url.pathname === "/api/consumo/semanal") return dashboardWeekly(url, env);
    if (request.method === "GET" && url.pathname === "/api/historico") return history(url, env);

    return json({ error: "Rota não encontrada." }, 404);
  },
};
