
CREATE TABLE IF NOT EXISTS device_secrets (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  encrypted_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_unlock_attempts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
