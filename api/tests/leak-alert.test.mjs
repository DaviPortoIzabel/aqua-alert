import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.API_TEST_BASE || 'http://127.0.0.1:8787';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Local tests only.');
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function measured(daysAgo) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}
async function call(path, { token, device, body, status = 200 } = {}) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { 'X-Device-Id': device.id, 'X-Device-Key': device.api_key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, path);
  return response.json();
}
async function account() {
  return call('/api/auth/register', { body: { name: 'Leak test', email: `leak-${randomUUID()}@example.test`, password: 'leak-test-password' }, status: 201 });
}
async function reading(user, daysAgo, liters) {
  return call('/api/leituras', { device: user.device, body: { litros: liters, medido_em: measured(daysAgo) }, status: 201 });
}
test('leak alert uses inclusive adjacent seven-day windows and isolates accounts', async () => {
  const user = await account(); const other = await account();
  await reading(user, 14, 900); // Outside both windows.
  await reading(user, 13, 40); await reading(user, 7, 60);
  await reading(user, 6, 90); await reading(user, 0, 100);
  await reading(other, 0, 999);
  await call('/api/alertas/vazamento', { status: 401 });
  const alert = await call('/api/alertas/vazamento', { token: user.token });
  assert.deepEqual(alert, { level: 'alta', increase_percent: 90, current_total: 190, previous_total: 100 });
  await call(`/api/alertas/vazamento?device_id=${other.device.id}`, { token: user.token, status: 404 });
});
test('leak thresholds preserve 40 and 80 percent boundaries and declining consumption', async () => {
  for (const [current, level, increase] of [[139, 'normal', 39], [140, 'media', 40], [180, 'media', 80], [181, 'alta', 81], [50, 'normal', 0]]) {
    const user = await account();
    await reading(user, 7, 100); await reading(user, 0, current);
    const alert = await call('/api/alertas/vazamento', { token: user.token });
    assert.equal(alert.level, level); assert.equal(alert.increase_percent, increase);
  }
});
test('empty history and zero previous consumption do not create infinite percentages', async () => {
  const user = await account();
  assert.deepEqual(await call('/api/alertas/vazamento', { token: user.token }), { level: 'normal', increase_percent: 0, current_total: 0, previous_total: 0 });
  await reading(user, 0, 45);
  assert.deepEqual(await call('/api/alertas/vazamento', { token: user.token }), { level: 'normal', increase_percent: 0, current_total: 45, previous_total: 0 });
});
