CREATE TABLE IF NOT EXISTS app_migrations (
  id TEXT PRIMARY KEY,
  applied_at DATETIME NOT NULL
);

UPDATE tools
SET
  created_at = datetime(created_at, '+9 hours'),
  updated_at = datetime(updated_at, '+9 hours')
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

UPDATE tool_items
SET
  created_at = datetime(created_at, '+9 hours'),
  updated_at = datetime(updated_at, '+9 hours')
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

UPDATE borrowers
SET
  created_at = datetime(created_at, '+9 hours'),
  updated_at = datetime(updated_at, '+9 hours')
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

UPDATE loans
SET
  borrowed_at = datetime(borrowed_at, '+9 hours'),
  returned_at = CASE
    WHEN returned_at IS NULL THEN NULL
    ELSE datetime(returned_at, '+9 hours')
  END,
  due_at = CASE
    WHEN due_at IS NULL THEN NULL
    ELSE datetime(due_at, '+9 hours')
  END,
  due_notice_sent_at = CASE
    WHEN due_notice_sent_at IS NULL THEN NULL
    ELSE datetime(due_notice_sent_at, '+9 hours')
  END,
  return_notice_sent_at = CASE
    WHEN return_notice_sent_at IS NULL THEN NULL
    ELSE datetime(return_notice_sent_at, '+9 hours')
  END
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

UPDATE loan_items
SET
  created_at = datetime(created_at, '+9 hours'),
  returned_at = CASE
    WHEN returned_at IS NULL THEN NULL
    ELSE datetime(returned_at, '+9 hours')
  END
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

UPDATE reservations
SET
  created_at = datetime(created_at, '+9 hours'),
  updated_at = datetime(updated_at, '+9 hours')
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

UPDATE system_settings
SET
  updated_at = datetime(updated_at, '+9 hours')
WHERE id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM app_migrations
    WHERE id = 'utc_to_jst_v1'
  );

UPDATE universal_return_times
SET
  created_at = datetime(created_at, '+9 hours')
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

UPDATE loan_return_notices
SET
  notified_at = datetime(notified_at, '+9 hours'),
  notice_date = substr(
    datetime(notified_at, '+9 hours'),
    1,
    10
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM app_migrations
  WHERE id = 'utc_to_jst_v1'
);

INSERT OR IGNORE INTO app_migrations (
  id,
  applied_at
)
VALUES (
  'utc_to_jst_v1',
  datetime('now', '+9 hours')
);
