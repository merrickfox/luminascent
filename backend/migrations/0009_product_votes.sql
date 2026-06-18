-- Per-user community votes. One vote per (user, product, dimension); the chosen
-- option determines the dimension. `user_id` is the Supabase user id (= users.id).
-- This table is the source of truth for the community profile; aggregate counts
-- are derived from it (product_vote_aggregates remains only for faceted search).
CREATE TABLE product_votes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  dimension_id TEXT NOT NULL,
  vote_option_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, product_id, dimension_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (dimension_id) REFERENCES vote_dimensions(id),
  FOREIGN KEY (vote_option_id) REFERENCES vote_options(id)
);

CREATE INDEX idx_product_votes_product ON product_votes(product_id);
CREATE INDEX idx_product_votes_user ON product_votes(user_id);
