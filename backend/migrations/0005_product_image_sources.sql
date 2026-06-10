CREATE TABLE product_image_sources (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  r2_image_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, source_url),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (r2_image_id) REFERENCES product_images(id)
);

CREATE INDEX idx_product_image_sources_product ON product_image_sources(product_id);
