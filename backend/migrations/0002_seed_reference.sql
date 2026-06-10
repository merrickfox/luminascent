INSERT INTO categories (id, name, slug) VALUES
  ('cat-candle', 'Candle', 'candle'),
  ('cat-perfume', 'Perfume', 'perfume'),
  ('cat-wax-melt', 'Wax Melt', 'wax_melt'),
  ('cat-room-spray', 'Room Spray', 'room_spray'),
  ('cat-diffuser', 'Diffuser', 'diffuser'),
  ('cat-incense', 'Incense', 'incense');

INSERT INTO vote_dimensions (id, name, slug) VALUES
  ('vd-rating-reaction', 'Rating Reaction', 'rating_reaction'),
  ('vd-season', 'Season', 'season'),
  ('vd-longevity', 'Longevity', 'longevity'),
  ('vd-sillage', 'Sillage', 'sillage'),
  ('vd-gender', 'Gender', 'gender'),
  ('vd-price-value', 'Price Value', 'price_value'),
  ('vd-time-of-day', 'Time of Day', 'time_of_day'),
  ('vd-occasion', 'Occasion', 'occasion');

INSERT INTO vote_options (id, dimension_id, label, slug, sort_order) VALUES
  ('vo-love', 'vd-rating-reaction', 'Love', 'love', 1),
  ('vo-like', 'vd-rating-reaction', 'Like', 'like', 2),
  ('vo-ok', 'vd-rating-reaction', 'OK', 'ok', 3),
  ('vo-dislike', 'vd-rating-reaction', 'Dislike', 'dislike', 4),
  ('vo-hate', 'vd-rating-reaction', 'Hate', 'hate', 5),
  ('vo-spring', 'vd-season', 'Spring', 'spring', 1),
  ('vo-summer', 'vd-season', 'Summer', 'summer', 2),
  ('vo-autumn', 'vd-season', 'Autumn', 'autumn', 3),
  ('vo-winter', 'vd-season', 'Winter', 'winter', 4),
  ('vo-very-weak', 'vd-longevity', 'Very Weak', 'very_weak', 1),
  ('vo-weak', 'vd-longevity', 'Weak', 'weak', 2),
  ('vo-moderate-longevity', 'vd-longevity', 'Moderate', 'moderate', 3),
  ('vo-long-lasting', 'vd-longevity', 'Long Lasting', 'long_lasting', 4),
  ('vo-eternal', 'vd-longevity', 'Eternal', 'eternal', 5),
  ('vo-intimate', 'vd-sillage', 'Intimate', 'intimate', 1),
  ('vo-moderate-sillage', 'vd-sillage', 'Moderate', 'moderate', 2),
  ('vo-strong', 'vd-sillage', 'Strong', 'strong', 3),
  ('vo-enormous', 'vd-sillage', 'Enormous', 'enormous', 4),
  ('vo-feminine', 'vd-gender', 'Feminine', 'feminine', 1),
  ('vo-masculine', 'vd-gender', 'Masculine', 'masculine', 2),
  ('vo-unisex', 'vd-gender', 'Unisex', 'unisex', 3),
  ('vo-overpriced', 'vd-price-value', 'Overpriced', 'overpriced', 1),
  ('vo-ok-value', 'vd-price-value', 'OK', 'ok', 2),
  ('vo-good-value', 'vd-price-value', 'Good Value', 'good_value', 3),
  ('vo-great-value', 'vd-price-value', 'Great Value', 'great_value', 4),
  ('vo-morning', 'vd-time-of-day', 'Morning', 'morning', 1),
  ('vo-day', 'vd-time-of-day', 'Day', 'day', 2),
  ('vo-evening', 'vd-time-of-day', 'Evening', 'evening', 3),
  ('vo-night', 'vd-time-of-day', 'Night', 'night', 4),
  ('vo-casual', 'vd-occasion', 'Casual', 'casual', 1),
  ('vo-office', 'vd-occasion', 'Office', 'office', 2),
  ('vo-date', 'vd-occasion', 'Date', 'date', 3),
  ('vo-formal', 'vd-occasion', 'Formal', 'formal', 4);

INSERT INTO accords (id, name, slug) VALUES
  ('acc-citrus', 'Citrus', 'citrus'),
  ('acc-woody', 'Woody', 'woody'),
  ('acc-vanilla', 'Vanilla', 'vanilla'),
  ('acc-smoky', 'Smoky', 'smoky'),
  ('acc-fresh-spicy', 'Fresh Spicy', 'fresh_spicy'),
  ('acc-amber', 'Amber', 'amber'),
  ('acc-powdery', 'Powdery', 'powdery'),
  ('acc-green', 'Green', 'green'),
  ('acc-floral', 'Floral', 'floral'),
  ('acc-gourmand', 'Gourmand', 'gourmand'),
  ('acc-aromatic', 'Aromatic', 'aromatic'),
  ('acc-earthy', 'Earthy', 'earthy');

INSERT INTO notes (id, name, slug, note_family) VALUES
  ('note-bergamot', 'Bergamot', 'bergamot', 'citrus'),
  ('note-cardamom', 'Cardamom', 'cardamom', 'spice'),
  ('note-cedar', 'Cedar', 'cedar', 'woods'),
  ('note-vanilla', 'Vanilla', 'vanilla', 'gourmand'),
  ('note-flour', 'Flour', 'flour', 'gourmand'),
  ('note-sandalwood', 'Sandalwood', 'sandalwood', 'woods'),
  ('note-rose', 'Rose', 'rose', 'floral'),
  ('note-jasmine', 'Jasmine', 'jasmine', 'floral'),
  ('note-amber', 'Amber', 'amber', 'resin'),
  ('note-patchouli', 'Patchouli', 'patchouli', 'woods');

INSERT INTO brands (id, name, slug, country) VALUES
  ('brand-diptyque', 'Diptyque', 'diptyque', 'France'),
  ('brand-yankee', 'Yankee Candle', 'yankee-candle', 'USA');

INSERT INTO products (
  id, category_id, brand_id, name, slug, description,
  size_grams, burn_time_hours, wax_type, price_amount, price_currency
) VALUES
  (
    'prod-feudebois',
    'cat-candle',
    'brand-diptyque',
    'Feu de Bois',
    'feu-de-bois',
    'A smoky, woody candle evoking a crackling fireplace.',
    190,
    60,
    'paraffin',
    6800,
    'GBP'
  ),
  (
    'prod-bakery',
    'cat-candle',
    'brand-yankee',
    'Bakery Scent',
    'bakery-scent',
    'Warm gourmand candle with flour and vanilla notes.',
    411,
    110,
    'soy',
    2499,
    'GBP'
  );

INSERT INTO scent_profiles (id, product_id, summary) VALUES
  ('sp-feudebois', 'prod-feudebois', 'Smoky woods with cedar and amber warmth.'),
  ('sp-bakery', 'prod-bakery', 'Sweet bakery gourmand with flour and vanilla.');

INSERT INTO scent_profile_notes (scent_profile_id, note_id, pyramid_stage, position_index) VALUES
  ('sp-feudebois', 'note-cedar', 'base', 1),
  ('sp-feudebois', 'note-amber', 'base', 2),
  ('sp-feudebois', 'note-sandalwood', 'middle', 1),
  ('sp-bakery', 'note-flour', 'general', 1),
  ('sp-bakery', 'note-vanilla', 'general', 2);

INSERT INTO scent_profile_accords (scent_profile_id, accord_id, strength_score, position_index) VALUES
  ('sp-feudebois', 'acc-woody', 0.9, 1),
  ('sp-feudebois', 'acc-smoky', 0.85, 2),
  ('sp-feudebois', 'acc-amber', 0.6, 3),
  ('sp-bakery', 'acc-gourmand', 0.95, 1),
  ('sp-bakery', 'acc-vanilla', 0.8, 2);

INSERT INTO product_rating_summaries (product_id, rating_avg, rating_count) VALUES
  ('prod-feudebois', 4.2, 85),
  ('prod-bakery', 3.86, 73);

INSERT INTO product_vote_aggregates (product_id, vote_option_id, vote_count) VALUES
  ('prod-feudebois', 'vo-winter', 42),
  ('prod-feudebois', 'vo-strong', 28),
  ('prod-feudebois', 'vo-enormous', 12),
  ('prod-feudebois', 'vo-love', 17),
  ('prod-feudebois', 'vo-like', 42),
  ('prod-bakery', 'vo-winter', 3),
  ('prod-bakery', 'vo-like', 42);

INSERT INTO product_search (product_id, name, brand_name, description, notes, accords, reviews) VALUES
  (
    'prod-feudebois',
    'Feu de Bois',
    'Diptyque',
    'A smoky, woody candle evoking a crackling fireplace.',
    'cedar amber sandalwood',
    'woody smoky amber',
    ''
  ),
  (
    'prod-bakery',
    'Bakery Scent',
    'Yankee Candle',
    'Warm gourmand candle with flour and vanilla notes.',
    'flour vanilla',
    'gourmand vanilla',
    ''
  );
