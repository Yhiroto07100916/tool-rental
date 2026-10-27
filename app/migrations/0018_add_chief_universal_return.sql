ALTER TABLE tools
ADD COLUMN universal_return_enabled_for_chief INTEGER NOT NULL DEFAULT 1;

CREATE TABLE universal_return_times_chief (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_time TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (return_time)
);
