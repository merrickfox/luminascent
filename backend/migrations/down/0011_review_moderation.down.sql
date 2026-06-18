-- Rollback: 0011_review_moderation
DROP INDEX IF EXISTS idx_reviews_status;
DROP INDEX IF EXISTS idx_reviews_user_product;
ALTER TABLE reviews DROP COLUMN moderation_note;
ALTER TABLE reviews DROP COLUMN moderated_at;
ALTER TABLE reviews DROP COLUMN status;
ALTER TABLE reviews DROP COLUMN user_id;
