import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.API_TEST_BASE || 'http://127.0.0.1:8787';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Run only against the local API.');
async function call(path, { token, device, body, status = 200 } = {}) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(device ? { 'X-Device-Key': device } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, status, path); return response.json();
}
async function user() { return call('/api/auth/register', { body: { name: 'Date filter test', email: `range-${randomUUID()}@example.test`, password: 'local-filter-test-123' }, status: 201 }); }
test('inclusive dates use São Paulo boundaries, aggregate totals and isolate devices', async () => {
  const first = await user(); const other = await user();
  for (const [litros, medido_em] of [[3, '2026-01-15T02:59:59Z'], [2, '2026-01-15T03:00:00Z'], [5, '2026-01-16T02:59:59Z'], [11, '2026-01-16T03:00:00Z'], [0, '2026-01-18T15:00:00Z']]) {
    await call('/api/leituras', { device: first.device.api_key, body: { litros, medido_em }, status: 201 });
  }
  await call('/api/leituras', { device: other.device.api_key, body: { litros: 999, medido_em: '2026-01-15T15:00:00Z' }, status: 201 });
  const single = await call('/api/consumo/periodo?start=2026-01-15&end=2026-01-15', { token: first.token });
  assert.equal(single.summary.total_liters, 7); assert.equal(single.summary.readings, 2); assert.equal(single.calendar_days, 1);
  const range = await call('/api/consumo/periodo?start=2026-01-15&end=2026-01-18', { token: first.token });
  assert.deepEqual(range.days.map(day => day.date), ['2026-01-15', '2026-01-16', '2026-01-18']);
  assert.equal(range.calendar_days, 4); assert.equal(range.summary.total_liters, 18); assert.equal(range.summary.recorded_days, 3); assert.equal(range.summary.average_liters, 6); assert.deepEqual(range.summary.peak, { date: '2026-01-16', liters: 11 });
  const empty = await call('/api/consumo/periodo?start=2026-02-01&end=2026-07-31', { token: first.token });
  assert.deepEqual(empty.days, []); assert.equal(empty.summary.average_liters, null); assert.equal(empty.summary.peak, null);
  const sixMonths = await call('/api/consumo/periodo?start=2025-12-01&end=2026-05-31', { token: first.token });
  assert.equal(sixMonths.summary.total_liters, 21); assert.equal(sixMonths.days.length, 4);
});
test('date ranges require authentication and reject invalid/reversed/future/oversized dates', async () => {
  const account = await user();
  await call('/api/consumo/periodo?start=2026-01-01&end=2026-01-02', { status: 401 });
  for (const query of ['', 'start=2026-02-30&end=2026-03-01', 'start=2026-01-02&end=2026-01-01', 'start=2026-1-1&end=2026-01-02', 'start=2000-01-01&end=2026-01-01', 'start=2099-01-01&end=2099-01-02']) {
    await call('/api/consumo/periodo?' + query, { token: account.token, status: 400 });
  }
});
