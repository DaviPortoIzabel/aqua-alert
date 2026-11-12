
CREATE TABLE IF NOT EXISTS device_code_attempts (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
