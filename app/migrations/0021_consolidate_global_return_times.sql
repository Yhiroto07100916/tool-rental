INSERT OR IGNORE INTO loan_return_notices (
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
  return_time_type
FROM loan_return_notices
WHERE return_time_id IN (
  SELECT id
  FROM universal_return_times
  WHERE id != (
    SELECT id
    FROM universal_return_times
    ORDER BY return_time ASC, id ASC
    LIMIT 1
  )
);

DELETE FROM loan_return_notices
WHERE return_time_id IN (
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

INSERT OR IGNORE INTO loan_return_notices (
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
  return_time_type
FROM loan_return_notices
WHERE return_time_id IN (
  SELECT id
  FROM universal_return_times_chief
  WHERE id != (
    SELECT id
    FROM universal_return_times_chief
    ORDER BY return_time ASC, id ASC
    LIMIT 1
  )
);

DELETE FROM loan_return_notices
WHERE return_time_id IN (
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
