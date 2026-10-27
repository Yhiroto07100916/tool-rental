CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  universal_return_time TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (
  id,
  universal_return_time
)
VALUES (
  1,
  NULL
);

ALTER TABLE loans
ADD COLUMN return_notice_sent_at DATETIME NULL;
