PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id),
  measured_at TEXT NOT NULL,
  liters REAL NOT NULL CHECK (liters >= 0),
  flow_lpm REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_readings_device_time
  ON readings(device_id, measured_at);

-- Dispositivo inicial. Troque o nome e o id se necessário antes do deploy.
INSERT OR IGNORE INTO devices (id, name) VALUES ('aqua-001', 'Sensor Aqua Alert');
