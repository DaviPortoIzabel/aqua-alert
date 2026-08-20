PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE devices ADD COLUMN owner_id INTEGER REFERENCES users(id);
ALTER TABLE devices ADD COLUMN device_key_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_id);
