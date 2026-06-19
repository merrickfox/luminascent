// Plain-JS twin of pipeline/image-bytes.ts (kept in sync) for the non-TS consumers:
// the capture server and scripts/repair-images.mjs. See that file for the rationale —
// trust the leading bytes, not the URL/extension, so a CDN 404 HTML page never gets
// stored as a broken image and the true format drives the saved extension.

export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  // GIF: "GIF8"
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { ext: 'gif', mime: 'image/gif' };
  }
  // WEBP: "RIFF" .... "WEBP"
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  // ISO-BMFF (AVIF / HEIC): "ftyp" box at offset 4, brand at offset 8.
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return { ext: 'avif', mime: 'image/avif' };
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1') || brand.startsWith('heif')) {
      return { ext: 'heic', mime: 'image/heic' };
    }
  }
  return null;
}

export function isImageBuffer(buffer) {
  return sniffImage(buffer) !== null;
}
