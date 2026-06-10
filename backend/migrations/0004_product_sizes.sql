CREATE TABLE product_sizes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  size_value REAL,
  size_unit TEXT,
  size_grams INTEGER,
  price_amount INTEGER,
  price_currency TEXT,
  sku TEXT,
  availability TEXT,
  source_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_product_sizes_product ON product_sizes(product_id);
