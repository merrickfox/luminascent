/**
 * Sniff a buffer's leading bytes to confirm it is a real raster image and report its
 * true format. Capture fetches occasionally return a non-image body with a 200/404 —
 * e.g. a CDN "404: Page not found" HTML page — which, saved with a `.jpg` name, becomes
 * a broken image downstream. Detecting the format from the bytes (not the URL/extension)
 * lets us reject junk and store the correct extension regardless of what the URL claimed.
 *
 * Returns the canonical extension + MIME, or null when the bytes are not a known image.
 */
export function sniffImage(buffer: Buffer): { ext: string; mime: string } | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
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

/** True when the buffer's leading bytes identify a known raster image format. */
export function isImageBuffer(buffer: Buffer): boolean {
  return sniffImage(buffer) !== null;
}
