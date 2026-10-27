ALTER TABLE tools
ADD COLUMN display_order INTEGER;

UPDATE tools
SET display_order = id
WHERE display_order IS NULL;
