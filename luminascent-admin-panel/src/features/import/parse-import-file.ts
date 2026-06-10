import type { ImportProductRecord, ParsedImportFile } from '@/lib/types'

function stripMetadata(record: Record<string, unknown>): ImportProductRecord {
  const {
    _provenance: _p,
    _timing: _t,
    _llm_error: _e,
    ...rest
  } = record

  return rest as ImportProductRecord
}

export function parseImportFile(text: string): ParsedImportFile {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON file')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of products')
  }

  if (parsed.length === 0) {
    throw new Error('File contains no products')
  }

  const invalidProducts: ParsedImportFile['invalidProducts'] = []
  const products: ImportProductRecord[] = []

  parsed.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      invalidProducts.push({ index, reason: 'Not an object' })
      return
    }

    const record = stripMetadata(entry as Record<string, unknown>)
    if (!record.name || typeof record.name !== 'string') {
      invalidProducts.push({ index, reason: 'Missing product name' })
      return
    }

    if (!record.category_slug || typeof record.category_slug !== 'string') {
      invalidProducts.push({ index, reason: 'Missing category_slug' })
      return
    }

    products.push(record)
  })

  const first = products[0]
  const brandSlug =
    first?.brand_slug ??
    products.find((product) => product.brand_slug)?.brand_slug ??
    ''
  const brandName =
    first?.brand_name ??
    products.find((product) => product.brand_name)?.brand_name ??
    brandSlug

  if (!brandSlug) {
    throw new Error('Could not detect brand_slug from import file')
  }

  const imageCount = products.reduce(
    (total, product) => total + (product.images?.length ?? 0),
    0,
  )

  return {
    products,
    brandName,
    brandSlug,
    productCount: products.length,
    imageCount,
    invalidCount: invalidProducts.length,
    invalidProducts,
  }
}
