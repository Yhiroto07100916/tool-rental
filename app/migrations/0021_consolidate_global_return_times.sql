
INSERT INTO loan_return_notices (
  loan_id,
  return_time_id,
  notice_date,
  notified_at,
  overdue_notified_at,
  return_time_type
)
SELECT
  loan_id,
  (SELECT id FROM universal_return_times ORDER BY return_time ASC, id ASC LIMIT 1),
  notice_date,
  notified_at,
  overdue_notified_at,
  'class'
FROM loan_return_notices
WHERE return_time_type = 'class'
  AND return_time_id IN (
    SELECT id
    FROM universal_return_times
    WHERE id != (
      SELECT id
      FROM universal_return_times
      ORDER BY return_time ASC, id ASC
      LIMIT 1
    )
  )
ON CONFLICT(loan_id, return_time_id, notice_date)
DO UPDATE SET
  notified_at = COALESCE(loan_return_notices.notified_at, excluded.notified_at),
  overdue_notified_at = COALESCE(loan_return_notices.overdue_notified_at, excluded.overdue_notified_at),
  return_time_type = 'class';

DELETE FROM loan_return_notices
WHERE return_time_type = 'class'
  AND return_time_id IN (
    SELECT id
    FROM universal_return_times
    WHERE id != (
      SELECT id
      FROM universal_return_times
      ORDER BY return_time ASC, id ASC
      LIMIT 1
    )
  );

DELETE FROM universal_return_times
WHERE id != (
  SELECT id
  FROM universal_return_times
  ORDER BY return_time ASC, id ASC
  LIMIT 1
);

INSERT INTO loan_return_notices (
  loan_id,
  return_time_id,
  notice_date,
  notified_at,
  overdue_notified_at,
  return_time_type
)
SELECT
  loan_id,
  (SELECT id FROM universal_return_times_chief ORDER BY return_time ASC, id ASC LIMIT 1),
  notice_date,
  notified_at,
  overdue_notified_at,
  'chief'
FROM loan_return_notices
WHERE return_time_type = 'chief'
  AND return_time_id IN (
    SELECT id
    FROM universal_return_times_chief
    WHERE id != (
      SELECT id
      FROM universal_return_times_chief
      ORDER BY return_time ASC, id ASC
      LIMIT 1
    )
  )
ON CONFLICT(loan_id, return_time_id, notice_date)
DO UPDATE SET
  notified_at = COALESCE(loan_return_notices.notified_at, excluded.notified_at),
  overdue_notified_at = COALESCE(loan_return_notices.overdue_notified_at, excluded.overdue_notified_at),
  return_time_type = 'chief';

DELETE FROM loan_return_notices
WHERE return_time_type = 'chief'
  AND return_time_id IN (
    SELECT id
    FROM universal_return_times_chief
    WHERE id != (
      SELECT id
      FROM universal_return_times_chief
      ORDER BY return_time ASC, id ASC
      LIMIT 1
    )
  );

DELETE FROM universal_return_times_chief
WHERE id != (
  SELECT id
  FROM universal_return_times_chief
  ORDER BY return_time ASC, id ASC
  LIMIT 1
);
