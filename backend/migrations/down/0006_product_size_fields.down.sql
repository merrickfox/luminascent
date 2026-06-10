ALTER TABLE products ADD COLUMN size_grams INTEGER;
ALTER TABLE products ADD COLUMN burn_time_hours INTEGER;
ALTER TABLE products ADD COLUMN price_amount INTEGER;
ALTER TABLE products ADD COLUMN price_currency TEXT;

UPDATE products
SET
  size_grams = (
    SELECT ps.size_grams FROM product_sizes ps
    WHERE ps.product_id = products.id AND ps.is_primary = 1
    ORDER BY ps.position LIMIT 1
  ),
  burn_time_hours = (
    SELECT ps.burn_time_hours FROM product_sizes ps
    WHERE ps.product_id = products.id AND ps.is_primary = 1
    ORDER BY ps.position LIMIT 1
  ),
  price_amount = (
    SELECT ps.price_amount FROM product_sizes ps
    WHERE ps.product_id = products.id AND ps.is_primary = 1
    ORDER BY ps.position LIMIT 1
  ),
  price_currency = (
    SELECT ps.price_currency FROM product_sizes ps
    WHERE ps.product_id = products.id AND ps.is_primary = 1
    ORDER BY ps.position LIMIT 1
  );

ALTER TABLE product_sizes DROP COLUMN burn_time_hours;
