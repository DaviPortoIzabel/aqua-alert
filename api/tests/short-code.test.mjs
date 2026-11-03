import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.API_TEST_BASE || 'http://127.0.0.1:8787';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Local tests only.');
async function call(path, { body, token, device, id, proof, status = 200 } = {}) {
 const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(device ? { 'X-Device-Key': device } : {}), ...(id ? { 'X-Device-Id': id } : {}), ...(proof ? { 'X-Device-Access': proof } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
 assert.equal(response.status, status, path); return response.json();
}
const password = 'short-code-local-test';
async function register() { return call('/api/auth/register', { body: { name: 'Short code test', email: `code-${randomUUID()}@example.test`, password }, status: 201 }); }
test('short keys require the device ID, work as strings and stay saved after new login', async () => {
 const user = await register(); assert.match(user.device.api_key, /^\d{5}$/); assert.match(user.device.id, /^ESP-/);
 await call('/api/leituras', { device: user.device.api_key, body: { litros: 1 }, status: 400 });
 await call('/api/leituras', { device: user.device.api_key, id: 'ESP-UNKNOWN-123', body: { litros: 1 }, status: 401 });
 await call('/api/leituras', { device: user.device.api_key, id: user.device.id, body: { litros: 1 }, status: 201 });
 await call('/api/leituras', { device: user.device.api_key, body: { device_id: user.device.id, litros: 2 }, status: 201 });
 const login = await call('/api/auth/login', { body: { email: user.user.email, password } });
 const opened = await call('/api/dispositivos/acesso', { token: login.token, body: { password } });
 assert.equal(opened.device.api_key, user.device.api_key);
});
test('five failed PIN guesses lock sensor access and authenticated rotation restores it', async () => {
 const user = await register(); const wrong = user.device.api_key === '00000' ? '00001' : '00000';
 await Promise.all(Array.from({ length: 5 }, () => call('/api/leituras', { device: wrong, id: user.device.id, body: { litros: 1 }, status: 401 })));
 await call('/api/leituras', { device: user.device.api_key, id: user.device.id, body: { litros: 1 }, status: 429 });
 const access = await call('/api/dispositivos/acesso', { token: user.token, body: { password } });
 const changed = await call('/api/dispositivos/chave', { token: user.token, proof: access.access_token, body: {} });
 assert.match(changed.device.api_key, /^\d{5}$/); assert.notEqual(changed.device.api_key, user.device.api_key);
 await call('/api/leituras', { device: changed.device.api_key, id: user.device.id, body: { litros: 1 }, status: 201 });
});
