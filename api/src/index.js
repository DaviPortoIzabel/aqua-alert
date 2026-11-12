const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device-Key, X-Device-Id, X-Device-Access",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
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
  const payload = base64url(encoder.encode(JSON.stringify({ sub: user.id, ver: user.auth_version || 0, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })));
  return `${payload}.${await hmac(payload, env.AUTH_SECRET)}`;
}

// auth_version permite revogar sessões antigas sem manter uma lista de tokens.
// Tokens com scope são autorizações específicas e não podem iniciar uma sessão.
async function currentUser(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await hmac(payload, env.AUTH_SECRET)) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (session.scope || !Number.isInteger(session.sub) || !Number.isFinite(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return null;
    const user = await env.DB.prepare("SELECT u.id, u.name, u.email, COALESCE(s.auth_version, 0) AS auth_version FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?").bind(session.sub).first();
    if (!user || (session.ver || 0) !== user.auth_version) return null;
    return user;
  } catch { return null; }
}

// Mesmo quando o cliente escolhe device_id, owner_id limita o acesso à conta.
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

// Rejeita a sobra da divisão do espaço de 32 bits para evitar viés no sorteio.
// Retorna string: códigos como "01234" precisam manter o zero inicial.
function newDeviceCode() {
  const limit = Math.floor(4294967296 / 100000) * 100000;
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= limit);
  return String(value % 100000).padStart(5, "0");
}
async function deviceCodeHash(code, deviceId, env) { return hmac(`device-code:v1:${deviceId}:${code}`, env.AUTH_SECRET); }

async function createDevice(ownerId, env) {
  const id = newDeviceId();
  const key = newDeviceCode();
  const encrypted = await encryptDeviceKey(key, ownerId, id, env);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO devices (id, name, owner_id, device_key_hash) VALUES (?, ?, ?, ?)").bind(id, "Meu ESP", ownerId, await deviceCodeHash(key, id, env)),
    env.DB.prepare("INSERT INTO device_secrets (device_id, encrypted_key) VALUES (?, ?)").bind(id, encrypted),
  ]);
  return { id, name: "Meu ESP", api_key: key };
}

function resetCode() { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"); }
async function resetCodeHash(userId, code, env) { return sha256(`${userId}:${code}:${env.AUTH_SECRET}`); }

async function sendResetEmail(user, code, env) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return false;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "accept": "application/json", "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: env.BREVO_SENDER_NAME || "Aqua Alert", email: env.BREVO_SENDER_EMAIL },
      to: [{ email: user.email, name: user.name }],
      subject: "Código para redefinir sua senha — Aqua Alert",
      htmlContent: `<p>Olá, ${user.name}.</p><p>Use este código para redefinir sua senha no Aqua Alert:</p><p style="font-size:28px;font-weight:700;letter-spacing:5px">${code}</p><p>Ele expira em 15 minutos. Se você não pediu a alteração, ignore este e-mail.</p>`,
    }),
  });
  return response.ok;
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
  const user = await env.DB.prepare("SELECT u.id, u.name, u.email, u.password_hash, COALESCE(s.auth_version, 0) AS auth_version FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.email = ?").bind(email).first();
  if (!user || !await verifyPassword(password, user.password_hash)) return json({ error: "E-mail ou senha incorretos." }, 401);
  return json({ token: await createSession(user, env), user: { name: user.name, email: user.email } });
}

async function forgotPassword(request, env) {
  const body = await parseJson(request); const email = body?.email?.trim().toLowerCase();
  const neutralResponse = { ok: true, message: "Se houver uma conta com este e-mail, enviaremos um código de verificação." };
  if (!validEmail(email)) return json(neutralResponse);
  const user = await env.DB.prepare("SELECT id, name, email FROM users WHERE email = ?").bind(email).first();
  if (!user) return json(neutralResponse);
  const attempts = await env.DB.prepare("SELECT COUNT(*) AS count FROM password_reset_codes WHERE user_id = ? AND created_at > datetime('now', '-1 hour')").bind(user.id).first();
  if (Number(attempts.count) >= 3) return json(neutralResponse);
  const code = resetCode(); const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const inserted = await env.DB.prepare("INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)").bind(user.id, await resetCodeHash(user.id, code, env), expiresAt).run();
  if (!await sendResetEmail(user, code, env)) {
    await env.DB.prepare("DELETE FROM password_reset_codes WHERE id = ?").bind(inserted.meta.last_row_id).run();
    return json({ error: "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos." }, 503);
  }
  return json(neutralResponse);
}

async function resetPassword(request, env) {
  const body = await parseJson(request); const email = body?.email?.trim().toLowerCase(); const code = body?.code?.trim(); const password = body?.password;
  if (!validEmail(email) || !/^\d{6}$/.test(code || "") || typeof password !== "string" || password.length < 8 || password.length > 128) return json({ error: "Informe e-mail, código de 6 dígitos e uma senha de pelo menos 8 caracteres." }, 400);
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (!user) return json({ error: "Código inválido ou expirado." }, 400);
  const reset = await env.DB.prepare("SELECT id FROM password_reset_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1").bind(user.id, await resetCodeHash(user.id, code, env), new Date().toISOString()).first();
  if (!reset) return json({ error: "Código inválido ou expirado." }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), user.id),
    env.DB.prepare("UPDATE password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL").bind(user.id),
    env.DB.prepare("INSERT INTO user_settings (user_id, auth_version) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET auth_version = auth_version + 1").bind(user.id),
  ]);
  return json({ ok: true, message: "Senha atualizada. Agora entre com a nova senha." });
}

async function me(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const settings = await env.DB.prepare("SELECT avatar, theme FROM user_settings WHERE user_id = ?").bind(result.user.id).first();
  return json({ user: { id: result.user.id, name: result.user.name, email: result.user.email, avatar: settings?.avatar || null, theme: settings?.theme || "system" }, device: result.device });
}

// Profile images are small JPEG data URLs, never arbitrary remote URLs or SVG.
function validAvatar(value) {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 140000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const bytes = atob(value.slice("data:image/jpeg;base64,".length));
    return bytes.length <= 100000 && bytes.length >= 4 && bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(bytes.length - 2) === 255 && bytes.charCodeAt(bytes.length - 1) === 217;
  } catch { return false; }
}

async function updateAccount(request, env) {
  const user = await currentUser(request, env);
  if (!user) return unauthorized();
  if (Number(request.headers.get("Content-Length")) > 150000) return json({ error: "A imagem é muito grande." }, 413);
  const raw = await request.text();
  if (raw.length > 150000) return json({ error: "A imagem é muito grande." }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: "Envie as preferências em JSON." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Preferências inválidas." }, 400);
  const hasAvatar = Object.hasOwn(body, "avatar");
  const hasTheme = Object.hasOwn(body, "theme");
  if ((!hasAvatar && !hasTheme) || (hasAvatar && !validAvatar(body.avatar)) || (hasTheme && !["light", "dark", "system"].includes(body.theme))) return json({ error: "Envie uma foto JPEG válida ou um tema disponível." }, 400);
  // Separate column updates preserve settings when two requests arrive together.
  const statements = [env.DB.prepare("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)").bind(user.id)];
  if (hasAvatar) statements.push(env.DB.prepare("UPDATE user_settings SET avatar = ? WHERE user_id = ?").bind(body.avatar, user.id));
  if (hasTheme) statements.push(env.DB.prepare("UPDATE user_settings SET theme = ? WHERE user_id = ?").bind(body.theme, user.id));
  await env.DB.batch(statements);
  return json({ ok: true });
}

async function changePassword(request, env) {
  const user = await currentUser(request, env);
  if (!user) return unauthorized();
  const body = await parseJson(request);
  if (typeof body?.current_password !== "string" || typeof body?.new_password !== "string" || body.new_password.length < 8 || body.new_password.length > 128) return json({ error: "Informe a senha atual e uma nova senha entre 8 e 128 caracteres." }, 400);
  const stored = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first();
  if (!stored || !await verifyPassword(body.current_password, stored.password_hash)) return json({ error: "A senha atual não está correta." }, 403);
  if (body.current_password === body.new_password) return json({ error: "Escolha uma senha diferente da atual." }, 400);
  const newHash = await hashPassword(body.new_password);
  // Optimistic check prevents concurrent password changes from reusing an old hash.
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?").bind(newHash, user.id, stored.password_hash),
    env.DB.prepare("INSERT INTO user_settings (user_id, auth_version) SELECT id, 1 FROM users WHERE id = ? AND password_hash = ? ON CONFLICT(user_id) DO UPDATE SET auth_version = auth_version + 1").bind(user.id, newHash),
    env.DB.prepare("UPDATE password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)").bind(user.id, user.id, newHash),
  ]);
  if (!results[0].meta.changes) return json({ error: "A senha foi alterada em outra sessão. Entre novamente." }, 409);
  const version = await env.DB.prepare("SELECT auth_version FROM user_settings WHERE user_id = ?").bind(user.id).first();
  return json({ ok: true, token: await createSession({ ...user, auth_version: version.auth_version }, env), message: "Senha alterada. As outras sessões foram encerradas." });
}

// AUTH_SECRET também protege as chaves recuperáveis do ESP. Preservá-lo entre
// deploys é necessário para decifrar valores já gravados em device_secrets.
async function deviceEncryptionKey(env) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(env.AUTH_SECRET), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("aqua-alert-device-storage-v1"), info: encoder.encode("encrypted-device-key") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// IV novo por cifragem; os dados associados vinculam o segredo à conta e ao ESP.
async function encryptDeviceKey(value, userId, deviceId, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`${userId}:${deviceId}`) }, await deviceEncryptionKey(env), encoder.encode(value));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
async function decryptDeviceKey(value, userId, deviceId, env) {
  const [iv, data] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(iv), additionalData: encoder.encode(`${userId}:${deviceId}`) }, await deviceEncryptionKey(env), fromBase64url(data));
  return new TextDecoder().decode(plain);
}
async function validDeviceAccess(request, user, device, env) {
  try {
    const [payload, signature] = (request.headers.get("X-Device-Access") || "").split(".");
    if (!payload || !signature || signature !== await hmac(payload, env.AUTH_SECRET)) return false;
    const proof = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    return proof.scope === "device-access" && proof.sub === user.id && proof.device === device.id && proof.ver === user.auth_version && Number.isFinite(proof.exp) && proof.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
async function unlockDevice(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const body = await parseJson(request);
  if (typeof body?.password !== "string" || !body.password || body.password.length > 128) return json({ error: "Informe sua senha para acessar o dispositivo." }, 400);
  const now = Math.floor(Date.now() / 1000);
  const attempt = await env.DB.prepare("INSERT INTO device_unlock_attempts (user_id, attempts, window_start) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END, window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END RETURNING attempts").bind(result.user.id, now, now - 600, now - 600).first();
  if (attempt.attempts > 5) return json({ error: "Muitas tentativas. Aguarde 10 minutos antes de tentar novamente." }, 429);
  const stored = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(result.user.id).first();
  if (!await verifyPassword(body.password, stored.password_hash)) return json({ error: "Senha incorreta. Confira a senha da sua conta." }, 403);
  await env.DB.prepare("DELETE FROM device_unlock_attempts WHERE user_id = ?").bind(result.user.id).run();
  const secret = await env.DB.prepare("SELECT encrypted_key FROM device_secrets WHERE device_id = ?").bind(result.device.id).first();
  const payload = base64url(encoder.encode(JSON.stringify({ scope: "device-access", sub: result.user.id, device: result.device.id, ver: result.user.auth_version, exp: now + 180 })));
  return json({ device: { ...result.device, api_key: secret ? await decryptDeviceKey(secret.encrypted_key, result.user.id, result.device.id, env) : null }, access_token: `${payload}.${await hmac(payload, env.AUTH_SECRET)}`, expires_at: now + 180 });
}
async function rotateDeviceKey(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  if (!await validDeviceAccess(request, result.user, result.device, env)) return json({ error: "Confirme sua senha novamente para acessar o ESP." }, 403);
  const previous = await env.DB.prepare("SELECT encrypted_key FROM device_secrets WHERE device_id = ?").bind(result.device.id).first();
  const oldKey = previous ? await decryptDeviceKey(previous.encrypted_key, result.user.id, result.device.id, env) : null;
  let key; do { key = newDeviceCode(); } while (key === oldKey);
  const encrypted = await encryptDeviceKey(key, result.user.id, result.device.id, env);
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET device_key_hash = ? WHERE id = ? AND owner_id = ?").bind(await deviceCodeHash(key, result.device.id, env), result.device.id, result.user.id),
    env.DB.prepare("INSERT INTO device_secrets (device_id, encrypted_key) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET encrypted_key = excluded.encrypted_key").bind(result.device.id, encrypted),
    env.DB.prepare("DELETE FROM device_code_attempts WHERE device_id = ?").bind(result.device.id),
  ]);
  return json({ device: { ...result.device, api_key: key } });
}

async function postReading(request, env) {
  const body = await parseJson(request);
  if (!body) return json({ error: "Envie os dados de leitura em JSON." }, 400);
  const deviceKey = request.headers.get("X-Device-Key");
  if (!deviceKey) return unauthorized();
  let device;
  if (/^\d{5}$/.test(deviceKey)) {
    const deviceId = request.headers.get("X-Device-Id") || body.device_id;
    if (!validDeviceId(deviceId)) return json({ error: "Envie o identificador do ESP junto da chave de 5 números." }, 400);
    const stored = await env.DB.prepare("SELECT id, device_key_hash FROM devices WHERE id = ?").bind(deviceId).first();
    if (!stored) return unauthorized();
    const now = Math.floor(Date.now() / 1000);
    // Reserve each attempt atomically before checking the small key space.
    const attempt = await env.DB.prepare("INSERT INTO device_code_attempts (device_id, attempts, window_start) VALUES (?, 1, ?) ON CONFLICT(device_id) DO UPDATE SET attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END, window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END RETURNING attempts").bind(deviceId, now, now - 600, now - 600).first();
    if (attempt.attempts > 5) return json({ error: "Acesso ao dispositivo temporariamente bloqueado. Aguarde 10 minutos ou gere uma nova chave pela conta." }, 429);
    if (stored.device_key_hash !== await deviceCodeHash(deviceKey, deviceId, env)) return unauthorized();
    await env.DB.prepare("DELETE FROM device_code_attempts WHERE device_id = ?").bind(deviceId).run();
    device = { id: stored.id };
  } else {
    // Existing long keys remain valid until their owner explicitly rotates them.
    device = await env.DB.prepare("SELECT id FROM devices WHERE device_key_hash = ?").bind(await sha256(deviceKey)).first();
    if (!device) return unauthorized();
  }
  const flow = body.fluxo ?? body.flow_lpm; let liters = body.litros;
  if (liters === undefined && Number.isFinite(Number(flow))) liters = Number(flow) * Number(body.intervalo_segundos ?? 5) / 60;
  liters = Number(liters);
  if (!Number.isFinite(liters) || liters < 0 || liters > 10000) return json({ error: "litros inválido." }, 400);
  const measured = body.medido_em ? new Date(body.medido_em) : new Date();
  if (Number.isNaN(measured.getTime())) return json({ error: "medido_em inválido." }, 400);
  // O D1 recebe horário civil de São Paulo; as consultas usam o mesmo calendário.
  const measuredAt = saoPauloDateTime(measured);
  await env.DB.prepare("INSERT INTO readings (device_id, measured_at, liters, flow_lpm) VALUES (?, ?, ?, ?)").bind(device.id, measuredAt, liters, Number.isFinite(Number(flow)) ? Number(flow) : null).run();
  return json({ ok: true, liters, measured_at: measuredAt }, 201);
}

async function dashboardToday(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const today = dateKey(new Date());
  const data = await env.DB.prepare("SELECT COALESCE(SUM(liters), 0) AS total_litros FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) = ?").bind(result.device.id, today).first();
  return json({ date: today, total_litros: Number(data.total_litros) });
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

// Compara duas janelas de 7 dias no calendário de São Paulo.
async function leakAlert(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const today = dateKey(new Date());
  const daysBefore = (days) => { const value = new Date(`${today}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - days); return value.toISOString().slice(0, 10); };
  const totals = await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN substr(measured_at, 1, 10) BETWEEN ? AND ? THEN liters ELSE 0 END), 0) AS current_total, COALESCE(SUM(CASE WHEN substr(measured_at, 1, 10) BETWEEN ? AND ? THEN liters ELSE 0 END), 0) AS previous_total FROM readings WHERE device_id = ?").bind(daysBefore(6), today, daysBefore(13), daysBefore(7), result.device.id).first();
  const currentTotal = Number(totals.current_total); const previousTotal = Number(totals.previous_total);
  const increasePercent = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;
  const level = increasePercent > 80 ? "alta" : increasePercent >= 40 ? "media" : "normal";
  return json({ level, increase_percent: Math.max(0, Number(increasePercent.toFixed(1))), current_total: Number(currentTotal.toFixed(2)), previous_total: Number(previousTotal.toFixed(2)) });
}

async function history(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const rows = await env.DB.prepare("SELECT substr(measured_at, 1, 10) AS dia, ROUND(SUM(liters), 3) AS total_litros, MAX(measured_at) AS ultima_atualizacao FROM readings WHERE device_id = ? GROUP BY dia ORDER BY dia DESC LIMIT 90").bind(result.device.id).all();
  return json(rows.results);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function dashboardRange(request, env) {
  const result = await requireDevice(request, env); if (result.response) return result.response;
  const url = new URL(request.url);
  const start = url.searchParams.get("start"); const end = url.searchParams.get("end");
  if (!validDate(start) || !validDate(end)) return json({ error: "Informe datas válidas no formato AAAA-MM-DD." }, 400);
  if (start > end) return json({ error: "A data inicial deve ser anterior ou igual à data final." }, 400);
  if (end > dateKey(new Date())) return json({ error: "A data final não pode estar no futuro." }, 400);
  const calendarDays = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1;
  if (calendarDays > 3660) return json({ error: "Escolha um período de até 10 anos." }, 400);
  const requested = url.searchParams.get("granularity") || "auto";
  if (!["auto", "hour", "day", "month"].includes(requested)) return json({ error: "Escolha um agrupamento disponível." }, 400);
  const granularity = requested === "auto" ? (calendarDays < 3 ? "hour" : calendarDays > 92 ? "month" : "day") : requested;
  if (granularity === "hour" && calendarDays > 31) return json({ error: "A visualização por hora está disponível para períodos de até 31 dias. Escolha diário, mensal ou automático." }, 400);
  // Limite exclusivo no dia seguinte inclui todas as horas da data final.
  const nextDay = new Date(`${end}T00:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const rows = await env.DB.prepare("SELECT substr(measured_at, 1, 10) AS date, SUM(liters) AS liters, COUNT(*) AS readings, MAX(measured_at) AS last_reading FROM readings WHERE device_id = ? AND measured_at >= ? AND measured_at < ? GROUP BY substr(measured_at, 1, 10) ORDER BY date ASC").bind(result.device.id, `${start} 00:00:00`, `${nextDay.toISOString().slice(0, 10)} 00:00:00`).all();
  // Só há linhas para dias com medições: ausência de leitura não é consumo zero.
  const days = rows.results.map(row => ({ ...row, liters: Number(row.liters), readings: Number(row.readings) }));
  const total = days.reduce((sum, day) => sum + day.liters, 0);
  const peak = days.reduce((best, day) => !best || day.liters > best.liters ? day : best, null);
  let points;
  if (granularity === "hour") {
    const hourly = await env.DB.prepare("SELECT substr(measured_at, 1, 13) || ':00' AS period, SUM(liters) AS liters, COUNT(*) AS readings FROM readings WHERE device_id = ? AND measured_at >= ? AND measured_at < ? GROUP BY substr(measured_at, 1, 13) ORDER BY period ASC").bind(result.device.id, `${start} 00:00:00`, `${nextDay.toISOString().slice(0, 10)} 00:00:00`).all();
    points = hourly.results.map(row => ({ ...row, liters: Number(row.liters), readings: Number(row.readings) }));
  } else if (granularity === "month") {
    const months = new Map();
    days.forEach(day => { const period = day.date.slice(0, 7); const entry = months.get(period) || { period, liters: 0, readings: 0 }; entry.liters += day.liters; entry.readings += day.readings; months.set(period, entry); });
    points = [...months.values()];
  } else points = days.map(day => ({ period: day.date, liters: day.liters, readings: day.readings }));
  return json({ start, end, calendar_days: calendarDays, days, series: { granularity, points }, summary: { total_liters: Math.round(total * 1000) / 1000, recorded_days: days.length, readings: days.reduce((sum, day) => sum + day.readings, 0), average_liters: days.length ? Math.round(total / days.length * 1000) / 1000 : null, peak: peak ? { date: peak.date, liters: peak.liters } : null } });
}

// Entrada do Worker: preflight CORS e despacho das rotas. A autenticação fica
// nos handlers para distinguir sessão do usuário de credenciais do sensor.
export default { async fetch(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/health") return json({ ok: true });
  if (request.method === "POST" && path === "/api/auth/register") return register(request, env);
  if (request.method === "POST" && path === "/api/auth/login") return login(request, env);
  if (request.method === "POST" && path === "/api/auth/forgot-password") return forgotPassword(request, env);
  if (request.method === "POST" && path === "/api/auth/reset-password") return resetPassword(request, env);
  if (request.method === "POST" && path === "/api/leituras") return postReading(request, env);
  if (request.method === "GET" && path === "/api/me") return me(request, env);
  if (request.method === "POST" && path === "/api/account") return updateAccount(request, env);
  if (request.method === "POST" && path === "/api/account/password") return changePassword(request, env);
  if (request.method === "POST" && path === "/api/dispositivos/acesso") return unlockDevice(request, env);
  if (request.method === "POST" && path === "/api/dispositivos/chave") return rotateDeviceKey(request, env);
  if (request.method === "GET" && path === "/api/consumo/periodo") return dashboardRange(request, env);
  if (request.method === "GET" && path === "/api/consumo/hoje") return dashboardToday(request, env);
  if (request.method === "GET" && path === "/api/consumo/diario") return dashboardDaily(request, env);
  if (request.method === "GET" && path === "/api/consumo/semanal") return dashboardWeekly(request, env);
  if (request.method === "GET" && path === "/api/alertas/vazamento") return leakAlert(request, env);
  if (request.method === "GET" && path === "/api/historico") return history(request, env);
  return json({ error: "Rota não encontrada." }, 404);
} };
