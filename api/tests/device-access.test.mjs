import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.API_TEST_BASE || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local tests only.');
async function call(path, { token, proof, body, device, status = 200 } = {}) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(proof ? { 'X-Device-Access': proof } : {}), ...(device ? { 'X-Device-Key': device } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, status, path); return response.json();
}
const password = 'device-test-password-123';
async function user() { return call('/api/auth/register', { body: { name: 'Device access test', email: `esp-${randomUUID()}@example.test`, password }, status: 201 }); }
test('device access verifies password, persists keys and scopes proof to the owner and password version', async () => {
  const owner = await user(); const other = await user();
  await call('/api/dispositivos/acesso', { body: { password }, status: 401 });
  await call('/api/dispositivos/acesso', { token: owner.token, body: { password: 'wrong' }, status: 403 });
  await call('/api/me', { token: owner.token });
  await call('/api/dispositivos/chave', { token: owner.token, body: {}, status: 403 });
  await call('/api/dispositivos/chave', { token: owner.token, proof: owner.token, body: {}, status: 403 });
  const unlocked = await call('/api/dispositivos/acesso', { token: owner.token, body: { password } });
  assert.equal(unlocked.device.api_key, owner.device.api_key);
  await call('/api/me', { token: unlocked.access_token, status: 401 });
  await call('/api/dispositivos/chave', { token: other.token, proof: unlocked.access_token, body: {}, status: 403 });
  const rotated = await call('/api/dispositivos/chave', { token: owner.token, proof: unlocked.access_token, body: {} });
  assert.notEqual(rotated.device.api_key, owner.device.api_key);
  const reopened = await call('/api/dispositivos/acesso', { token: owner.token, body: { password } });
  assert.equal(reopened.device.api_key, rotated.device.api_key);
  await call('/api/leituras', { device: owner.device.api_key, body: { litros: 1 }, status: 401 });
  await call('/api/leituras', { device: rotated.device.api_key, body: { litros: 1 }, status: 201 });
  const changed = await call('/api/account/password', { token: owner.token, body: { current_password: password, new_password: password + '-new' } });
  await call('/api/dispositivos/chave', { token: changed.token, proof: unlocked.access_token, body: {}, status: 403 });
  const afterChange = await call('/api/dispositivos/acesso', { token: changed.token, body: { password: password + '-new' } });
  assert.equal(afterChange.device.api_key, rotated.device.api_key);
});
test('repeated wrong device passwords are rate limited without ending the normal session', async () => {
  const account = await user();
  for (let attempt = 0; attempt < 5; attempt++) await call('/api/dispositivos/acesso', { token: account.token, body: { password: 'wrong' }, status: 403 });
  await call('/api/dispositivos/acesso', { token: account.token, body: { password }, status: 429 });
  await call('/api/me', { token: account.token });
});
