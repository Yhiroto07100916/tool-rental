ALTER TABLE notification_settings
ADD COLUMN line_channel_secret_encrypted TEXT NULL;

CREATE TABLE IF NOT EXISTS line_notification_destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_type TEXT NOT NULL
    CHECK (destination_type IN ('user', 'group', 'room')),
  destination_id TEXT NOT NULL UNIQUE,
  display_name TEXT NULL,
  last_seen_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_line_notification_destinations_last_seen
  ON line_notification_destinations(last_seen_at DESC);
