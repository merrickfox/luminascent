ALTER TABLE product_sizes ADD COLUMN burn_time_hours INTEGER;

INSERT INTO product_sizes (
  id, product_id, size_value, size_unit, size_grams, price_amount, price_currency,
  burn_time_hours, sku, availability, source_url, position, is_primary
)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  p.id,
  p.size_grams,
  'g',
  p.size_grams,
  p.price_amount,
  p.price_currency,
  p.burn_time_hours,
  NULL,
  NULL,
  NULL,
  0,
  1
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM product_sizes ps WHERE ps.product_id = p.id
)
AND (
  p.size_grams IS NOT NULL
  OR p.price_amount IS NOT NULL
  OR p.burn_time_hours IS NOT NULL
);

ALTER TABLE products DROP COLUMN size_grams;
ALTER TABLE products DROP COLUMN burn_time_hours;
ALTER TABLE products DROP COLUMN price_amount;
ALTER TABLE products DROP COLUMN price_currency;
