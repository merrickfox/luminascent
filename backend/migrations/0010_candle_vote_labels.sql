-- Candle-friendly relabel of community vote dimensions/options. Display labels
-- only — slugs and ids are unchanged, so nothing downstream breaks.
-- Sillage -> "Hot throw"; Enormous -> "Fills the room"; longevity reworded to a
-- duration scale (no "weak").
UPDATE vote_dimensions SET name = 'Hot throw' WHERE id = 'vd-sillage';
UPDATE vote_options SET label = 'Fills the room' WHERE id = 'vo-enormous';
UPDATE vote_options SET label = 'Fleeting' WHERE id = 'vo-very-weak';
UPDATE vote_options SET label = 'Brief' WHERE id = 'vo-weak';
UPDATE vote_options SET label = 'Long-lasting' WHERE id = 'vo-long-lasting';
