CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_product_images_product ON product_images(product_id);
