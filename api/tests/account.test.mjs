import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = process.env.API_TEST_BASE || 'http://127.0.0.1:8787';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use only an isolated local API for these tests.');
async function call(path, { token, body, status = 200 } = {}) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, status, `Unexpected status for ${path}`);
  return response.json();
}
async function register() {
  const email = `account-${randomUUID()}@example.test`;
  const password = 'initial-password-123';
  const user = await call('/api/auth/register', { body: { name: '<Account Test>', email, password }, status: 201 });
  return { ...user, email, password };
}
test('account preferences persist, stay isolated, validate input and survive new sessions', async () => {
  const first = await register(); const second = await register();
  const secondId = (await call('/api/me', { token: second.token })).user.id;
  const avatar = 'data:image/jpeg;base64,' + (await readFile(new URL('./fixtures/avatar.jpg', import.meta.url))).toString('base64');
  await call('/api/account', { body: { avatar }, status: 401 });
  await call('/api/account', { token: first.token, body: { avatar: '<svg></svg>' }, status: 400 });
  await call('/api/account', { token: first.token, body: { avatar: 'data:image/jpeg;base64,AAAA' }, status: 400 });
  await call('/api/account', { token: first.token, body: { avatar: 'data:image/jpeg;base64,' + 'A'.repeat(150000) }, status: 413 });
  await call('/api/account', { token: first.token, body: { theme: 'invalid' }, status: 400 });
  await Promise.all([call('/api/account', { token: first.token, body: { avatar, user_id: secondId } }), call('/api/account', { token: first.token, body: { theme: 'dark' } })]);
  const again = await call('/api/auth/login', { body: { email: first.email, password: first.password } });
  const saved = await call('/api/me', { token: again.token });
  assert.equal(saved.user.avatar, avatar); assert.equal(saved.user.theme, 'dark');
  assert.equal(Object.hasOwn(saved.user, 'password_hash'), false);
  const other = await call('/api/me', { token: second.token });
  assert.equal(other.user.avatar, null); assert.equal(other.user.theme, 'system');
  await call('/api/account', { token: again.token, body: { avatar: null } });
  assert.equal((await call('/api/me', { token: again.token })).user.avatar, null);
  assert.equal((await call('/api/me', { token: again.token })).user.theme, 'dark');
});
test('password change requires the current password and revokes all older tokens', async () => {
  const user = await register();
  const newPassword = 'new-password-456';
  await call('/api/account/password', { body: { current_password: user.password, new_password: newPassword }, status: 401 });
  await call('/api/account/password', { token: user.token, body: { current_password: 'wrong', new_password: newPassword }, status: 403 });
  await call('/api/me', { token: user.token });
  await call('/api/account/password', { token: user.token, body: { current_password: user.password, new_password: 'short' }, status: 400 });
  await call('/api/account/password', { token: user.token, body: { current_password: user.password, new_password: user.password }, status: 400 });
  const changed = await call('/api/account/password', { token: user.token, body: { current_password: user.password, new_password: newPassword } });
  assert.ok(changed.token);
  await call('/api/me', { token: user.token, status: 401 });
  await call('/api/account', { token: user.token, body: { theme: 'light' }, status: 401 });
  await call('/api/me', { token: changed.token });
  await call('/api/auth/login', { body: { email: user.email, password: user.password }, status: 401 });
  const fresh = await call('/api/auth/login', { body: { email: user.email, password: newPassword } });
  await call('/api/me', { token: fresh.token });
});
