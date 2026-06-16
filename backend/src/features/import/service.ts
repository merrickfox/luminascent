import { ALLOWED_IMAGE_TYPES, buildImageKey, imagePublicUrl, MAX_IMAGE_BYTES } from '../../lib/images';
import { slugify } from '../../lib/slug';
import { createAccord, fillAccordColorIfNull, getAccordBySlug } from '../accords/repo';
import { createBrand, getBrandBySlug } from '../brands/repo';
import { listProductImages, setProductImages } from '../images/repo';
import type { ProductImageInput } from '../images/types';
import { createNote, fillNoteColorIfNull, getNoteBySlug } from '../notes/repo';
import { createProduct, getProductBySlug, updateProduct } from '../products/repo';
import type { ScrapedProduct } from './schema';
import type {
	EnsureBrandResult,
	ImageImportDetail,
	ImportImageStats,
	ImportOptions,
	ImportProductResult,
	ImportProductStatus,
	RefEnsureCounts,
} from './types';

type ImportEnv = {
	DB: D1Database;
	BUCKET: R2Bucket;
	R2_PUBLIC_BASE_URL: string;
};

function toProductInput(record: ScrapedProduct) {
	return {
		name: record.name,
		slug: record.slug,
		category_slug: record.category_slug,
		brand_slug: record.brand_slug,
		release_year: record.release_year ?? undefined,
		description: record.description ?? undefined,
		scent_summary: record.scent_summary ?? undefined,
		wax_type: record.wax_type ?? undefined,
		vessel_material: record.vessel_material ?? undefined,
		is_discontinued: record.is_discontinued ?? false,
		sizes: record.sizes?.map((size, index) => ({
			size_value: size.size_value ?? undefined,
			size_unit: size.size_unit ?? undefined,
			size_grams: size.size_grams ?? undefined,
			price_amount: size.price_amount ?? undefined,
			price_currency: size.price_currency ?? undefined,
			burn_time_hours: size.burn_time_hours ?? undefined,
			sku: size.sku ?? undefined,
			availability: size.availability ?? undefined,
			source_url: size.source_url ?? undefined,
			position: index,
			is_primary: size.is_primary ?? index === 0,
		})),
		notes: record.notes?.map((note, index) => ({
			note_slug: note.note_slug,
			pyramid_stage: note.pyramid_stage ?? 'unknown',
			position_index: index,
		})),
		accords: record.accords?.map((accord, index) => ({
			accord_slug: accord.accord_slug,
			position_index: index,
		})),
	};
}

function inferContentTypeFromUrl(url: string): string | null {
	const lower = url.toLowerCase();
	if (lower.includes('.webp')) return 'image/webp';
	if (lower.includes('.png')) return 'image/png';
	if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
	return null;
}

const IMAGE_FETCH_USER_AGENTS = [
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	'curl/8.7.1',
];

function shortUserAgent(userAgent: string): string {
	if (userAgent.startsWith('Mozilla')) return 'browser';
	return userAgent.split('/')[0] || userAgent;
}

async function fetchImageResponse(sourceUrl: string): Promise<{ response: Response; userAgent: string }> {
	const attemptSummaries: string[] = [];

	for (const userAgent of IMAGE_FETCH_USER_AGENTS) {
		try {
			const response = await fetch(sourceUrl, {
				headers: {
					'User-Agent': userAgent,
					Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
				},
			});

			console.log(`[import:image] GET ${sourceUrl} ua=${shortUserAgent(userAgent)} -> ${response.status}`);
			if (response.ok) return { response, userAgent };
			attemptSummaries.push(`${shortUserAgent(userAgent)}=HTTP ${response.status}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'fetch failed';
			console.error(`[import:image] GET ${sourceUrl} ua=${shortUserAgent(userAgent)} -> error: ${message}`);
			attemptSummaries.push(`${shortUserAgent(userAgent)}=${message}`);
		}
	}

	throw new Error(`All fetch attempts failed (${attemptSummaries.join(', ')})`);
}

async function uploadImageBytes(
	bucket: R2Bucket,
	productId: string,
	buffer: ArrayBuffer,
	contentType: string,
): Promise<{ r2Key: string; contentType: string; bytes: number }> {
	if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
		throw new Error(`Unsupported content type: ${contentType}`);
	}

	if (buffer.byteLength > MAX_IMAGE_BYTES) {
		throw new Error('Image exceeds maximum size of 10MB');
	}

	const r2Key = buildImageKey(productId, contentType);
	await bucket.put(r2Key, buffer, {
		httpMetadata: { contentType },
	});

	return { r2Key, contentType, bytes: buffer.byteLength };
}

async function fetchAndUploadImage(
	bucket: R2Bucket,
	productId: string,
	sourceUrl: string,
): Promise<{ r2Key: string; contentType: string; bytes: number; userAgent: string }> {
	const { response, userAgent } = await fetchImageResponse(sourceUrl);

	let contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
	if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
		const inferred = inferContentTypeFromUrl(sourceUrl);
		if (inferred && ALLOWED_IMAGE_TYPES.has(inferred)) {
			contentType = inferred;
		} else {
			throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
		}
	}

	const buffer = await response.arrayBuffer();
	const uploaded = await uploadImageBytes(bucket, productId, buffer, contentType);

	return { ...uploaded, userAgent };
}

async function uploadInlineImage(
	bucket: R2Bucket,
	productId: string,
	dataBase64: string,
	contentTypeHint?: string,
): Promise<{ r2Key: string; contentType: string; bytes: number }> {
	let contentType = contentTypeHint?.split(';')[0]?.trim() ?? '';
	if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
		contentType = 'image/jpeg';
	}

	const binary = atob(dataBase64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return uploadImageBytes(bucket, productId, bytes.buffer, contentType);
}

async function ensureNotes(db: D1Database, notes: NonNullable<ScrapedProduct['notes']>): Promise<RefEnsureCounts> {
	let created = 0;
	let existing = 0;

	for (const note of notes) {
		const found = await getNoteBySlug(db, note.note_slug);
		if (found) {
			if (!found.color && note.color) {
				await fillNoteColorIfNull(db, found.id, {
					color: note.color,
					color_gradient: note.color_gradient,
				});
			}
			existing += 1;
			continue;
		}

		await createNote(db, {
			name: note.name,
			slug: note.note_slug,
			color: note.color,
			color_gradient: note.color_gradient,
		});
		created += 1;
	}

	return { created, existing };
}

async function ensureAccords(db: D1Database, accords: NonNullable<ScrapedProduct['accords']>): Promise<RefEnsureCounts> {
	let created = 0;
	let existing = 0;

	for (const accord of accords) {
		const found = await getAccordBySlug(db, accord.accord_slug);
		if (found) {
			if (!found.color && accord.color) {
				await fillAccordColorIfNull(db, found.id, {
					color: accord.color,
					color_gradient: accord.color_gradient,
				});
			}
			existing += 1;
			continue;
		}

		await createAccord(db, {
			name: accord.name,
			slug: accord.accord_slug,
			color: accord.color,
			color_gradient: accord.color_gradient,
		});
		created += 1;
	}

	return { created, existing };
}

async function importImagesForProduct(
	env: ImportEnv,
	productId: string,
	images: NonNullable<ScrapedProduct['images']>,
	refetchImages: boolean,
	isNewProduct: boolean,
): Promise<ImportImageStats & { warnings: string[] }> {
	const existingImages = await listProductImages(env.DB, productId, env.R2_PUBLIC_BASE_URL);
	console.log(
		`[import:image] product=${productId} requested=${images.length} existing=${existingImages.length} isNew=${isNewProduct} refetch=${refetchImages}`,
	);

	if (!isNewProduct && !refetchImages && existingImages.length > 0) {
		console.log(`[import:image] product=${productId} keeping ${existingImages.length} existing image(s), skipping fetch`);
		return { requested: images.length, added: 0, kept: existingImages.length, failed: [], details: [], warnings: [] };
	}

	if (images.length === 0) {
		return { requested: 0, added: 0, kept: existingImages.length, failed: [], details: [], warnings: [] };
	}

	const uploaded: ProductImageInput[] = [];
	const failed: { url: string; error: string }[] = [];
	const details: ImageImportDetail[] = [];
	const warnings: string[] = [];
	const sortedImages = [...images].sort((a, b) => a.position - b.position);

	for (const image of sortedImages) {
		const imageLabel = image.source_url ?? `inline@${image.position}`;
		try {
			if (image.data_base64) {
				const { r2Key, contentType, bytes } = await uploadInlineImage(
					env.BUCKET,
					productId,
					image.data_base64,
					image.content_type,
				);
				uploaded.push({
					r2_key: r2Key,
					position: image.position,
					is_primary: image.is_primary,
				});
				details.push({
					url: imageLabel,
					outcome: 'uploaded',
					r2_key: r2Key,
					content_type: contentType,
					bytes,
				});
				console.log(
					`[import:image] product=${productId} uploaded inline image @${image.position} -> ${r2Key} (${bytes} bytes, ${contentType})`,
				);
				continue;
			}

			if (!image.source_url) {
				throw new Error('Image missing source_url and data_base64');
			}

			const { r2Key, contentType, bytes, userAgent } = await fetchAndUploadImage(
				env.BUCKET,
				productId,
				image.source_url,
			);
			uploaded.push({
				r2_key: r2Key,
				position: image.position,
				is_primary: image.is_primary,
			});
			details.push({
				url: image.source_url,
				outcome: 'uploaded',
				r2_key: r2Key,
				content_type: contentType,
				bytes,
				user_agent: shortUserAgent(userAgent),
			});
			console.log(`[import:image] product=${productId} uploaded ${image.source_url} -> ${r2Key} (${bytes} bytes, ${contentType})`);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			failed.push({ url: imageLabel, error: message });
			details.push({ url: imageLabel, outcome: 'failed', error: message });
			console.error(`[import:image] product=${productId} FAILED ${imageLabel}: ${message}`);
		}
	}

	console.log(`[import:image] product=${productId} done: uploaded=${uploaded.length} failed=${failed.length}`);

	if (uploaded.length === 0 && images.length > 0) {
		warnings.push('No images were uploaded successfully');
		return { requested: images.length, added: 0, kept: 0, failed, details, warnings };
	}

	if (uploaded.length > 0) {
		const { removedKeys } = await setProductImages(env.DB, productId, uploaded);
		await Promise.all(removedKeys.map((key) => env.BUCKET.delete(key).catch(() => {})));

		const primary = uploaded.find((image) => image.is_primary) ?? uploaded[0];
		await updateProduct(env.DB, productId, {
			image_url: imagePublicUrl(env.R2_PUBLIC_BASE_URL, primary.r2_key),
		});
	}

	return { requested: images.length, added: uploaded.length, kept: 0, failed, details, warnings };
}

export async function ensureBrand(
	db: D1Database,
	input: { name: string; slug: string; country?: string; website_url?: string },
): Promise<EnsureBrandResult> {
	const existing = await getBrandBySlug(db, input.slug);
	if (existing) {
		return { brand: existing, status: 'existing' };
	}

	const brand = await createBrand(db, input);
	return { brand, status: 'created' };
}

export async function importProduct(env: ImportEnv, record: ScrapedProduct, options: ImportOptions): Promise<ImportProductResult> {
	const slug = record.slug ?? slugify(record.name);
	const warnings: string[] = [];

	try {
		const notesResult = await ensureNotes(env.DB, record.notes ?? []);
		const accordsResult = await ensureAccords(env.DB, record.accords ?? []);
		const productInput = toProductInput(record);
		const existing = await getProductBySlug(env.DB, slug);

		let status: ImportProductStatus;
		let productId: string;

		if (!existing) {
			const product = await createProduct(env.DB, productInput);
			productId = product.id;
			status = 'created';
		} else if (options.update_existing) {
			const { product } = await updateProduct(env.DB, existing.id, productInput);
			if (!product) throw new Error('Failed to update product');
			productId = product.id;
			status = 'updated';
		} else {
			return {
				status: 'skipped',
				slug,
				productId: existing.id,
				notes: notesResult,
				accords: accordsResult,
				images: { requested: record.images?.length ?? 0, added: 0, kept: 0, failed: [], details: [] },
				warnings,
			};
		}

		const imageStats = await importImagesForProduct(env, productId, record.images ?? [], options.refetch_images, status === 'created');

		return {
			status,
			productId,
			slug,
			notes: notesResult,
			accords: accordsResult,
			images: {
				requested: imageStats.requested,
				added: imageStats.added,
				kept: imageStats.kept,
				failed: imageStats.failed,
				details: imageStats.details,
			},
			warnings: [...warnings, ...imageStats.warnings],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Import failed';
		console.error(`[import] product slug=${slug} failed: ${message}`);
		return {
			status: 'failed',
			slug,
			notes: { created: 0, existing: 0 },
			accords: { created: 0, existing: 0 },
			images: { requested: record.images?.length ?? 0, added: 0, kept: 0, failed: [], details: [] },
			warnings,
			error: message,
		};
	}
}
