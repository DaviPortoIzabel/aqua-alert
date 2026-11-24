import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const secret = 'local-legacy-compatibility-test-secret';
const legacyId = 'ESP-LEGACY-001';
const otherId = 'ESP-OTHER-002';
function hash(code, id) {
  return createHmac('sha256', secret).update(`device-code:v1:${id}:${code}`).digest('base64url');
}
function fixture(t, enabled = true) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO users (name, email, password_hash) VALUES ('Fixture', 'legacy@example.test', 'unused'), ('Other', 'other@example.test', 'unused')");
  const insert = db.prepare('INSERT INTO devices (id, name, owner_id, device_key_hash) VALUES (?, ?, ?, ?)');
  insert.run(legacyId, 'Legacy', 1, hash('01234', legacyId));
  insert.run(otherId, 'Other', 2, hash('56789', otherId));
  // Executa o SQL real do handler em SQLite, adaptando apenas a interface D1.
  const env = { AUTH_SECRET: secret, ...(enabled ? { LEGACY_DEVICE_ID: legacyId } : {}), DB: {
    prepare(sql) { return { bind(...args) { return {
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() { return db.prepare(sql).run(...args); },
    }; } }; },
  } };
  async function send(key = '01234', headers = {}, data = { litros: 2.4111, fluxo: 2.41, intervalo_segundos: 60 }) {
    return worker.fetch(new Request('https://local.test/api/leituras', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': key, ...headers },
      body: JSON.stringify(data),
    }), env);
  }
  return { db, env, send };
}

test('legacy fallback is disabled by default and accepts unchanged firmware only when configured', async t => {
  const { env, db, send } = fixture(t, false);
  assert.equal((await send()).status, 400);
  env.LEGACY_DEVICE_ID = legacyId;
  assert.equal((await send()).status, 201);
  const row = db.prepare('SELECT device_id, liters FROM readings').get();
  assert.equal(row.device_id, legacyId); assert.equal(row.liters, 2.4111);
  delete env.LEGACY_DEVICE_ID;
  assert.equal((await send()).status, 400);
});

test('legacy fallback never guesses another device and does not override explicit identifiers', async t => {
  const { db, send } = fixture(t);
  assert.equal((await send('56789')).status, 401);
  assert.equal((await send('01234', { 'X-Device-Id': '' })).status, 400);
  assert.equal((await send('01234', {}, { device_id: null, litros: 1 })).status, 400);
  assert.equal((await send('01234', { 'X-Device-Id': otherId })).status, 401);
  assert.equal((await send('56789', { 'X-Device-Id': otherId })).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM readings WHERE device_id = ?').get(legacyId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM readings WHERE device_id = ?').get(otherId).count, 1);
});

test('legacy and identified requests share the same atomic attempt limit', async t => {
  const { send } = fixture(t);
  const attempts = await Promise.all(Array.from({ length: 5 }, () => send('00000')));
  assert.ok(attempts.every(response => response.status === 401));
  assert.equal((await send()).status, 429);
  assert.equal((await send('01234', { 'X-Device-Id': legacyId })).status, 429);
});

test('legacy fallback honors key rotation and rejects invalid configuration', async t => {
  const { db, env, send } = fixture(t);
  db.prepare('UPDATE devices SET device_key_hash = ? WHERE id = ?').run(hash('09876', legacyId), legacyId);
  assert.equal((await send()).status, 401);
  assert.equal((await send('09876')).status, 201);
  env.LEGACY_DEVICE_ID = 'invalid';
  assert.equal((await send('09876')).status, 400);
  env.LEGACY_DEVICE_ID = 'ESP-UNKNOWN';
  assert.equal((await send('09876')).status, 401);
});
