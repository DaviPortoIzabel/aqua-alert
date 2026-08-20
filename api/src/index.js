const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device-Key",
  "Content-Type": "application/json; charset=utf-8",
};
const encoder = new TextEncoder();

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
function unauthorized() { return json({ error: "Faça login para continuar." }, 401); }
function base64url(bytes) { let text = ""; bytes.forEach((byte) => { text += String.fromCharCode(byte); }); return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function fromBase64url(value) { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); }
function randomText(bytes = 24) { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }
function validDeviceId(value) { return typeof value === "string" && /^[A-Z0-9-]{6,64}$/.test(value); }
function validEmail(value) { return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254; }
function saoPauloDateTime(date) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date); }
function dateKey(date) { return saoPauloDateTime(date).slice(0, 10); }

async function parseJson(request) { try { return await request.json(); } catch { return null; } }
async function sha256(value) { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
async function hmac(value, secret) { const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))); }

async function hashPassword(password, salt = randomText(16)) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return `${salt}.${base64url(new Uint8Array(derived))}`;
}

async function verifyPassword(password, stored) {
  const [salt] = String(stored).split(".");
  return salt && (await hashPassword(password, salt)) === stored;
}

async function createSession(user, env) {
  const payload = base64url(encoder.encode(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })));
  return `${payload}.${await hmac(payload, env.AUTH_SECRET)}`;
}

async function currentUser(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await hmac(payload, env.AUTH_SECRET)) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (!Number.isInteger(session.sub) || session.exp < Math.floor(Date.now() / 1000)) return null;
    return await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?").bind(session.sub).first();
  } catch { return null; }
}

async function userDevice(userId, url, env) {
  const id = url.searchParams.get("device_id");
  const query = id ? "SELECT id, name FROM devices WHERE id = ? AND owner_id = ?" : "SELECT id, name FROM devices WHERE owner_id = ? ORDER BY created_at LIMIT 1";
  const statement = id ? env.DB.prepare(query).bind(id, userId) : env.DB.prepare(query).bind(userId);
  return statement.first();
}

async function requireDevice(request, env) {
  const user = await currentUser(request, env);
  if (!user) return { response: unauthorized() };
  const device = await userDevice(user.id, new URL(request.url), env);
  if (!device) return { response: json({ error: "Nenhum ESP cadastrado nesta conta." }, 404) };
  return { user, device };
}

function newDeviceId() { return `ESP-${randomText(6).toUpperCase().replaceAll("_", "X").replaceAll("-", "Y")}`; }

async function createDevice(ownerId, env) {
  const id = newDeviceId();
  const key = randomText(32);
  await env.DB.prepare("INSERT INTO devices (id, name, owner_id, device_key_hash) VALUES (?, ?, ?, ?)").bind(id, "Meu ESP", ownerId, await sha256(key)).run();
  return { id, name: "Meu ESP", api_key: key };
}

async function register(request, env) {
  const body = await parseJson(request);
  const name = body?.name?.trim(); const email = body?.email?.trim().toLowerCase(); const password = body?.password;
  if (!name || name.length > 80 || !validEmail(email) || typeof password !== "string" || password.length < 8 || password.length > 128) return json({ error: "Preencha nome, e-mail válido e uma senha de pelo menos 8 caracteres." }, 400);
  if (await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()) return json({ error: "Já existe uma conta com este e-mail." }, 409);
  const inserted = await env.DB.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").bind(name, email, await hashPassword(password)).run();
  const user = { id: inserted.meta.last_row_id, name, email };
  const device = await createDevice(user.id, env);
  return json({ token: await createSession(user, env), user: { name, email }, device }, 201);
}

async function login(request, env) {
  const body = await parseJson(request); const email = body?.email?.trim().toLowerCase(); const password = body?.password;
  if (!validEmail(email) || typeof password !== "string") return json({ error: "E-mail ou senha inválidos." }, 400);
  const user = await env.DB.prepare("SELECT id, name, email, password_hash FROM users WHERE email = ?").bind(email).first();
  if (!user || !await verifyPassword(password, user.password_hash)) return json({ error: "E-mail ou senha incorretos." }, 401);
  return json({ token: await createSession(user, env), user: { name: user.name, email: user.email } });
}

async function me(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  return json({ user: result.user, device: result.device });
}

async function rotateDeviceKey(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const key = randomText(32);
  await env.DB.prepare("UPDATE devices SET device_key_hash = ? WHERE id = ? AND owner_id = ?").bind(await sha256(key), result.device.id, result.user.id).run();
  return json({ device: { ...result.device, api_key: key } });
}

async function postReading(request, env) {
  const body = await parseJson(request);
  if (!body || !validDeviceId(body.device_id)) return json({ error: "device_id inválido." }, 400);
  const deviceKey = request.headers.get("X-Device-Key");
  if (!deviceKey) return unauthorized();
  const device = await env.DB.prepare("SELECT id FROM devices WHERE id = ? AND device_key_hash = ?").bind(body.device_id, await sha256(deviceKey)).first();
  if (!device) return unauthorized();
  const flow = body.fluxo ?? body.flow_lpm; let liters = body.litros;
  if (liters === undefined && Number.isFinite(Number(flow))) liters = Number(flow) * Number(body.intervalo_segundos ?? 5) / 60;
  liters = Number(liters);
  if (!Number.isFinite(liters) || liters < 0 || liters > 10000) return json({ error: "litros inválido." }, 400);
  const measured = body.medido_em ? new Date(body.medido_em) : new Date();
  if (Number.isNaN(measured.getTime())) return json({ error: "medido_em inválido." }, 400);
  const measuredAt = saoPauloDateTime(measured);
  await env.DB.prepare("INSERT INTO readings (device_id, measured_at, liters, flow_lpm) VALUES (?, ?, ?, ?)").bind(device.id, measuredAt, liters, Number.isFinite(Number(flow)) ? Number(flow) : null).run();
  return json({ ok: true, device_id: device.id, liters, measured_at: measuredAt }, 201);
}

async function dashboardToday(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const today = dateKey(new Date());
  const data = await env.DB.prepare("SELECT COALESCE(SUM(liters), 0) AS total_litros FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) = ?").bind(result.device.id, today).first();
  return json({ device_id: result.device.id, date: today, total_litros: Number(data.total_litros) });
}

async function dashboardDaily(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const rows = await env.DB.prepare("SELECT substr(measured_at, 12, 2) || ':00' AS hora, ROUND(SUM(liters), 3) AS total FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) = ? GROUP BY hora ORDER BY hora").bind(result.device.id, dateKey(new Date())).all();
  return json({ labels: rows.results.map((row) => row.hora), valores: rows.results.map((row) => Number(row.total)) });
}

async function dashboardWeekly(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const start = new Date(); start.setDate(start.getDate() - 6);
  const rows = await env.DB.prepare("SELECT substr(measured_at, 1, 10) AS dia, ROUND(SUM(liters), 3) AS total FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) >= ? GROUP BY dia ORDER BY dia").bind(result.device.id, dateKey(start)).all();
  return json({ labels: rows.results.map((row) => `${row.dia.slice(8, 10)}/${row.dia.slice(5, 7)}`), valores: rows.results.map((row) => Number(row.total)) });
}

async function history(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const rows = await env.DB.prepare("SELECT substr(measured_at, 1, 10) AS dia, device_id, ROUND(SUM(liters), 3) AS total_litros, MAX(measured_at) AS ultima_atualizacao FROM readings WHERE device_id = ? GROUP BY dia, device_id ORDER BY dia DESC LIMIT 90").bind(result.device.id).all();
  return json(rows.results);
}

export default { async fetch(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/health") return json({ ok: true });
  if (request.method === "POST" && path === "/api/auth/register") return register(request, env);
  if (request.method === "POST" && path === "/api/auth/login") return login(request, env);
  if (request.method === "POST" && path === "/api/leituras") return postReading(request, env);
  if (request.method === "GET" && path === "/api/me") return me(request, env);
  if (request.method === "POST" && path === "/api/dispositivos/chave") return rotateDeviceKey(request, env);
  if (request.method === "GET" && path === "/api/consumo/hoje") return dashboardToday(request, env);
  if (request.method === "GET" && path === "/api/consumo/diario") return dashboardDaily(request, env);
  if (request.method === "GET" && path === "/api/consumo/semanal") return dashboardWeekly(request, env);
  if (request.method === "GET" && path === "/api/historico") return history(request, env);
  return json({ error: "Rota não encontrada." }, 404);
} };
