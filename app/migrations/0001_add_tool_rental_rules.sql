ALTER TABLE tools
ADD COLUMN max_quantity_per_class INTEGER NULL;

ALTER TABLE tools
ADD COLUMN loan_duration_minutes INTEGER NULL;

ALTER TABLE tools
ADD COLUMN due_notice_enabled INTEGER NOT NULL DEFAULT 1;
