CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  country TEXT,
  website_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  brand_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  release_year INTEGER,
  description TEXT,
  image_url TEXT,
  size_grams INTEGER,
  burn_time_hours INTEGER,
  wax_type TEXT,
  vessel_material TEXT,
  price_amount INTEGER,
  price_currency TEXT,
  is_discontinued INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (brand_id) REFERENCES brands(id)
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_name ON products(name);

CREATE TABLE scent_profiles (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  note_family TEXT
);

CREATE TABLE scent_profile_notes (
  scent_profile_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  pyramid_stage TEXT,
  position_index INTEGER,
  PRIMARY KEY (scent_profile_id, note_id, pyramid_stage),
  FOREIGN KEY (scent_profile_id) REFERENCES scent_profiles(id),
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE INDEX idx_profile_notes_note ON scent_profile_notes(note_id);
CREATE INDEX idx_profile_notes_stage ON scent_profile_notes(pyramid_stage);

CREATE TABLE accords (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE scent_profile_accords (
  scent_profile_id TEXT NOT NULL,
  accord_id TEXT NOT NULL,
  strength_score REAL,
  position_index INTEGER,
  PRIMARY KEY (scent_profile_id, accord_id),
  FOREIGN KEY (scent_profile_id) REFERENCES scent_profiles(id),
  FOREIGN KEY (accord_id) REFERENCES accords(id)
);

CREATE INDEX idx_profile_accords_accord ON scent_profile_accords(accord_id);

CREATE TABLE vote_dimensions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE vote_options (
  id TEXT PRIMARY KEY,
  dimension_id TEXT NOT NULL,
  label TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER,
  UNIQUE (dimension_id, slug),
  FOREIGN KEY (dimension_id) REFERENCES vote_dimensions(id)
);

CREATE TABLE product_vote_aggregates (
  product_id TEXT NOT NULL,
  vote_option_id TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, vote_option_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (vote_option_id) REFERENCES vote_options(id)
);

CREATE INDEX idx_vote_aggregates_option ON product_vote_aggregates(vote_option_id, product_id);

CREATE TABLE product_rating_summaries (
  product_id TEXT PRIMARY KEY,
  rating_avg REAL,
  rating_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_rating_avg ON product_rating_summaries(rating_avg);
CREATE INDEX idx_rating_count ON product_rating_summaries(rating_count);

CREATE TABLE product_reminds_me_of (
  product_id TEXT NOT NULL,
  reminded_product_id TEXT,
  external_brand_name TEXT,
  external_product_name TEXT,
  external_source_url TEXT,
  thumbs_up INTEGER NOT NULL DEFAULT 0,
  thumbs_down INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    product_id,
    reminded_product_id,
    external_brand_name,
    external_product_name
  ),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (reminded_product_id) REFERENCES products(id)
);

CREATE INDEX idx_reminds_me_product ON product_reminds_me_of(product_id);
CREATE INDEX idx_reminds_me_target ON product_reminds_me_of(reminded_product_id);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  author_name TEXT,
  rating REAL,
  title TEXT,
  body TEXT NOT NULL,
  language TEXT,
  helpful_count INTEGER,
  unhelpful_count INTEGER,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_reviews_published ON reviews(published_at);

CREATE VIRTUAL TABLE product_search USING fts5(
  product_id UNINDEXED,
  name,
  brand_name,
  description,
  notes,
  accords,
  reviews
);
