const IMAGE_ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const ALLOWED_IMAGE_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/webp',
]);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/webp': 'webp',
};

export function randomImageId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	let id = '';
	for (const byte of bytes) {
		id += IMAGE_ID_CHARS[byte % IMAGE_ID_CHARS.length];
	}
	return id;
}

export function extensionForContentType(contentType: string): string {
	return MIME_TO_EXT[contentType] ?? 'png';
}

export function buildImageKey(productId: string, contentType: string): string {
	const ext = extensionForContentType(contentType);
	return `${productId}/${randomImageId()}.${ext}`;
}

export function imagePublicUrl(baseUrl: string, key: string): string {
	const normalized = baseUrl.replace(/\/$/, '');
	return `${normalized}/${key}`;
}

export function isValidImageKeyForProduct(productId: string, key: string): boolean {
	const pattern = new RegExp(
		`^${productId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-zA-Z0-9]{6}\\.(png|jpg|jpeg|webp)$`,
	);
	return pattern.test(key);
}
