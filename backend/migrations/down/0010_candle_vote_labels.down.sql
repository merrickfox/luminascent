-- Rollback: 0010_candle_vote_labels
UPDATE vote_dimensions SET name = 'Sillage' WHERE id = 'vd-sillage';
UPDATE vote_options SET label = 'Enormous' WHERE id = 'vo-enormous';
UPDATE vote_options SET label = 'Very Weak' WHERE id = 'vo-very-weak';
UPDATE vote_options SET label = 'Weak' WHERE id = 'vo-weak';
UPDATE vote_options SET label = 'Long Lasting' WHERE id = 'vo-long-lasting';
