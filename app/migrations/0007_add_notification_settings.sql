CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  channel TEXT NOT NULL DEFAULT 'discord'
    CHECK (channel IN ('none', 'discord', 'line')),
  discord_webhook_encrypted TEXT NULL,
  line_channel_access_token_encrypted TEXT NULL,
  line_destination_type TEXT NULL
    CHECK (
      line_destination_type IS NULL
      OR line_destination_type IN ('user', 'group', 'room')
    ),
  line_destination_id TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO notification_settings (
  id,
  channel,
  created_at,
  updated_at
)
VALUES (
  1,
  'discord',
  datetime('now', '+9 hours'),
  datetime('now', '+9 hours')
);
