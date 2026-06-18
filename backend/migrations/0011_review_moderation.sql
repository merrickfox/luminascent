-- User reviews + moderation. user_id is the Supabase user id (= users.id);
-- legacy/imported reviews keep user_id NULL. status gates public visibility.
ALTER TABLE reviews ADD COLUMN user_id TEXT;
ALTER TABLE reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE reviews ADD COLUMN moderated_at TEXT;
ALTER TABLE reviews ADD COLUMN moderation_note TEXT;

-- Pre-existing reviews were already shown publicly — keep them visible.
UPDATE reviews SET status = 'approved' WHERE status = 'pending';

-- One review per user per product (legacy NULL-user rows are exempt).
CREATE UNIQUE INDEX idx_reviews_user_product ON reviews(user_id, product_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_reviews_status ON reviews(status);
