ALTER TABLE loan_items
ADD COLUMN returned_by_id INTEGER
REFERENCES borrowers(id);
