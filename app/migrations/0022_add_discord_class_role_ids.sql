ALTER TABLE notification_settings
ADD COLUMN discord_class_role_ids TEXT NOT NULL DEFAULT '{}';
