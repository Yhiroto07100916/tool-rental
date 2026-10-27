ALTER TABLE loan_items
ADD COLUMN overdue_seconds INTEGER NOT NULL DEFAULT 0;

UPDATE loan_items
SET overdue_seconds = overdue_minutes * 60;

-- 既存の overdue_minutes は互換性のため残す
