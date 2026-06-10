import { isValidImageKeyForProduct } from '../../lib/images';
import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import { slugify } from '../../lib/slug';
import type { Accord } from '../accords/types';
import type { Brand } from '../brands/types';
import type { Category } from '../categories/types';
import type { Note } from '../notes/types';
import type { RemindsMeOf } from '../reminds/types';
import type { Review } from '../reviews/types';
import { getVoteAggregatesForProduct } from '../votes/repo';
import type { VoteAggregate } from '../votes/types';
import { listProductImages, setProductImages } from '../images/repo';
import type { ProductImageInput } from '../images/types';
import { listProductSizes, setProductSizes } from '../sizes/repo';
import type { ProductSizeInput } from '../sizes/types';
import { rebuildProductSearch } from './fts';
import type {
	Product,
	ProductDetail,
	ProductListFilters,
	ProductRatingSummary,
	ScentProfile,
	ScentProfileAccord,
	ScentProfileNote,
} from './types';

type ProductInput = {
	id?: string;
	name: string;
	slug?: string;
	category_slug: string;
	brand_slug?: string;
	release_year?: number;
	description?: string;
	image_url?: string;
	wax_type?: string;
	vessel_material?: string;
	is_discontinued?: boolean;
	scent_summary?: string;
	sizes?: ProductSizeInput[];
	notes?: { note_slug: string; pyramid_stage?: string; position_index?: number }[];
	accords?: { accord_slug: string; strength_score?: number; position_index?: number }[];
	images?: ProductImageInput[];
};

export async function getProductById(db: Db, id: string): Promise<Product | null> {
	return queryOne<Product>(db, `SELECT * FROM products WHERE id = ?`, id);
}

export async function getProductBySlug(db: Db, slug: string): Promise<Product | null> {
	return queryOne<Product>(db, `SELECT * FROM products WHERE slug = ?`, slug);
}

async function getScentProfile(db: Db, productId: string): Promise<ScentProfile | null> {
	return queryOne<ScentProfile>(db, `SELECT * FROM scent_profiles WHERE product_id = ?`, productId);
}

async function getScentNotes(db: Db, scentProfileId: string): Promise<ScentProfileNote[]> {
	const rows = await queryAll<Note & { pyramid_stage: string | null; position_index: number | null }>(
		db,
		`SELECT n.*, spn.pyramid_stage, spn.position_index
		 FROM scent_profile_notes spn
		 JOIN notes n ON n.id = spn.note_id
		 WHERE spn.scent_profile_id = ?
		 ORDER BY spn.position_index, n.name`,
		scentProfileId,
	);

	return rows.map((row) => ({
		note: {
			id: row.id,
			name: row.name,
			slug: row.slug,
			note_family: row.note_family,
		},
		pyramid_stage: row.pyramid_stage,
		position_index: row.position_index,
	}));
}

async function getScentAccords(db: Db, scentProfileId: string): Promise<ScentProfileAccord[]> {
	const rows = await queryAll<Accord & { strength_score: number | null; position_index: number | null }>(
		db,
		`SELECT a.*, spa.strength_score, spa.position_index
		 FROM scent_profile_accords spa
		 JOIN accords a ON a.id = spa.accord_id
		 WHERE spa.scent_profile_id = ?
		 ORDER BY spa.position_index, a.name`,
		scentProfileId,
	);

	return rows.map((row) => ({
		accord: {
			id: row.id,
			name: row.name,
			slug: row.slug,
		},
		strength_score: row.strength_score,
		position_index: row.position_index,
	}));
}

async function getRating(db: Db, productId: string): Promise<ProductRatingSummary | null> {
	return queryOne<ProductRatingSummary>(
		db,
		`SELECT * FROM product_rating_summaries WHERE product_id = ?`,
		productId,
	);
}

async function getReminds(db: Db, productId: string): Promise<RemindsMeOf[]> {
	return queryAll<RemindsMeOf>(
		db,
		`SELECT * FROM product_reminds_me_of WHERE product_id = ? ORDER BY thumbs_up DESC`,
		productId,
	);
}

async function getReviews(db: Db, productId: string): Promise<Review[]> {
	return queryAll<Review>(
		db,
		`SELECT * FROM reviews WHERE product_id = ? ORDER BY published_at DESC, created_at DESC`,
		productId,
	);
}

export async function getProductDetail(
	db: Db,
	slug: string,
	publicBaseUrl: string,
): Promise<ProductDetail | null> {
	const product = await getProductBySlug(db, slug);
	if (!product) return null;

	const category = await queryOne<Category>(
		db,
		`SELECT * FROM categories WHERE id = ?`,
		product.category_id,
	);
	if (!category) return null;

	const brand = product.brand_id
		? await queryOne<Brand>(db, `SELECT * FROM brands WHERE id = ?`, product.brand_id)
		: null;

	const scentProfile = await getScentProfile(db, product.id);
	const notes = scentProfile ? await getScentNotes(db, scentProfile.id) : [];
	const accords = scentProfile ? await getScentAccords(db, scentProfile.id) : [];
	const votes = await getVoteAggregatesForProduct(db, product.id);
	const rating = await getRating(db, product.id);
	const reminds = await getReminds(db, product.id);
	const reviews = await getReviews(db, product.id);
	const images = await listProductImages(db, product.id, publicBaseUrl);
	const sizes = await listProductSizes(db, product.id);

	return {
		product,
		category,
		brand,
		scent_profile: scentProfile,
		notes,
		accords,
		votes,
		rating,
		reminds,
		reviews,
		images,
		sizes,
	};
}

function buildListQuery(filters: ProductListFilters): { sql: string; params: unknown[] } {
	const conditions: string[] = [];
	const params: unknown[] = [];
	const joins: string[] = [
		`JOIN categories c ON c.id = p.category_id`,
	];

	if (filters.category) {
		conditions.push(`c.slug = ?`);
		params.push(filters.category);
	}

	if (filters.brand) {
		joins.push(`JOIN brands b ON b.id = p.brand_id`);
		conditions.push(`b.slug = ?`);
		params.push(filters.brand);
	}

	if (filters.min_rating !== undefined) {
		joins.push(`JOIN product_rating_summaries prs ON prs.product_id = p.id`);
		conditions.push(`prs.rating_avg >= ?`);
		params.push(filters.min_rating);
	}

	if (filters.notes?.length) {
		joins.push(`JOIN scent_profiles sp ON sp.product_id = p.id`);
		joins.push(`JOIN scent_profile_notes spn ON spn.scent_profile_id = sp.id`);
		joins.push(`JOIN notes n ON n.id = spn.note_id`);
		const placeholders = filters.notes.map(() => '?').join(', ');
		conditions.push(`n.slug IN (${placeholders})`);
		params.push(...filters.notes);
	}

	if (filters.accords?.length) {
		if (!filters.notes?.length) {
			joins.push(`JOIN scent_profiles sp ON sp.product_id = p.id`);
		}
		joins.push(`JOIN scent_profile_accords spa ON spa.scent_profile_id = sp.id`);
		joins.push(`JOIN accords a ON a.id = spa.accord_id`);
		const placeholders = filters.accords.map(() => '?').join(', ');
		conditions.push(`a.slug IN (${placeholders})`);
		params.push(...filters.accords);
	}

	if (filters.vote_options?.length) {
		for (let i = 0; i < filters.vote_options.length; i++) {
			const alias = `pva${i}`;
			const aliasOpt = `vo${i}`;
			joins.push(`JOIN product_vote_aggregates ${alias} ON ${alias}.product_id = p.id`);
			joins.push(`JOIN vote_options ${aliasOpt} ON ${aliasOpt}.id = ${alias}.vote_option_id`);
			conditions.push(`${aliasOpt}.slug = ?`);
			conditions.push(`${alias}.vote_count > 0`);
			params.push(filters.vote_options[i]);
		}
	}

	const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
	const orderBy =
		filters.sort === 'rating'
			? `ORDER BY prs.rating_avg DESC`
			: filters.sort === 'newest'
				? `ORDER BY p.created_at DESC`
				: `ORDER BY p.name ASC`;

	const limit = filters.limit ?? 20;
	const offset = filters.offset ?? 0;

	const sql = `
		SELECT DISTINCT p.*
		FROM products p
		${joins.join('\n')}
		${where}
		${orderBy}
		LIMIT ? OFFSET ?
	`;

	params.push(limit, offset);

	return { sql, params };
}

export async function listProducts(db: Db, filters: ProductListFilters): Promise<Product[]> {
	const { sql, params } = buildListQuery(filters);
	return queryAll<Product>(db, sql, ...params);
}

async function resolveCategoryId(db: Db, slug: string): Promise<string> {
	const category = await queryOne<{ id: string }>(
		db,
		`SELECT id FROM categories WHERE slug = ?`,
		slug,
	);
	if (!category) throw new Error(`Unknown category: ${slug}`);
	return category.id;
}

async function resolveBrandId(db: Db, slug: string): Promise<string> {
	const brand = await queryOne<{ id: string }>(
		db,
		`SELECT id FROM brands WHERE slug = ?`,
		slug,
	);
	if (!brand) throw new Error(`Unknown brand: ${slug}`);
	return brand.id;
}

async function upsertScentProfile(
	db: Db,
	productId: string,
	summary?: string,
	notes?: ProductInput['notes'],
	accords?: ProductInput['accords'],
): Promise<void> {
	let profile = await getScentProfile(db, productId);

	if (!profile) {
		const profileId = newId();
		await execute(
			db,
			`INSERT INTO scent_profiles (id, product_id, summary) VALUES (?, ?, ?)`,
			profileId,
			productId,
			summary ?? null,
		);
		profile = await getScentProfile(db, productId);
	} else if (summary !== undefined) {
		await execute(
			db,
			`UPDATE scent_profiles SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?`,
			summary,
			productId,
		);
	}

	if (!profile) return;

	if (notes) {
		await execute(db, `DELETE FROM scent_profile_notes WHERE scent_profile_id = ?`, profile.id);
		const seenNotes = new Set<string>();
		for (const note of notes) {
			const stage = note.pyramid_stage ?? 'general';
			const dedupeKey = `${note.note_slug}::${stage}`;
			if (seenNotes.has(dedupeKey)) continue;
			seenNotes.add(dedupeKey);

			const noteRow = await queryOne<{ id: string }>(
				db,
				`SELECT id FROM notes WHERE slug = ?`,
				note.note_slug,
			);
			if (!noteRow) throw new Error(`Unknown note: ${note.note_slug}`);

			await execute(
				db,
				`INSERT INTO scent_profile_notes (scent_profile_id, note_id, pyramid_stage, position_index)
				 VALUES (?, ?, ?, ?)`,
				profile.id,
				noteRow.id,
				stage,
				note.position_index ?? null,
			);
		}
	}

	if (accords) {
		await execute(db, `DELETE FROM scent_profile_accords WHERE scent_profile_id = ?`, profile.id);
		const seenAccords = new Set<string>();
		for (const accord of accords) {
			if (seenAccords.has(accord.accord_slug)) continue;
			seenAccords.add(accord.accord_slug);

			const accordRow = await queryOne<{ id: string }>(
				db,
				`SELECT id FROM accords WHERE slug = ?`,
				accord.accord_slug,
			);
			if (!accordRow) throw new Error(`Unknown accord: ${accord.accord_slug}`);

			await execute(
				db,
				`INSERT INTO scent_profile_accords (scent_profile_id, accord_id, strength_score, position_index)
				 VALUES (?, ?, ?, ?)`,
				profile.id,
				accordRow.id,
				accord.strength_score ?? null,
				accord.position_index ?? null,
			);
		}
	}
}

export async function createProduct(db: Db, input: ProductInput): Promise<Product> {
	const id = input.id ?? newId();
	const slug = input.slug ?? slugify(input.name);
	const categoryId = await resolveCategoryId(db, input.category_slug);
	const brandId = input.brand_slug ? await resolveBrandId(db, input.brand_slug) : null;

	await execute(
		db,
		`INSERT INTO products (
			id, category_id, brand_id, name, slug, release_year, description, image_url,
			wax_type, vessel_material, is_discontinued
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		categoryId,
		brandId,
		input.name,
		slug,
		input.release_year ?? null,
		input.description ?? null,
		input.image_url ?? null,
		input.wax_type ?? null,
		input.vessel_material ?? null,
		input.is_discontinued ? 1 : 0,
	);

	if (input.scent_summary || input.notes || input.accords) {
		await upsertScentProfile(db, id, input.scent_summary, input.notes, input.accords);
	}

	if (input.images?.length) {
		for (const image of input.images) {
			if (!isValidImageKeyForProduct(id, image.r2_key)) {
				throw new Error(`Invalid image key for product: ${image.r2_key}`);
			}
		}
		await setProductImages(db, id, input.images);
	}

	if (input.sizes?.length) {
		await setProductSizes(db, id, input.sizes);
	}

	await rebuildProductSearch(db, id);

	const product = await getProductById(db, id);
	if (!product) throw new Error('Failed to create product');
	return product;
}

export async function updateProduct(
	db: Db,
	id: string,
	input: Partial<ProductInput>,
): Promise<{ product: Product | null; removedImageKeys: string[] }> {
	const existing = await getProductById(db, id);
	if (!existing) return { product: null, removedImageKeys: [] };

	const fields: string[] = [];
	const params: unknown[] = [];
	let removedImageKeys: string[] = [];

	if (input.name !== undefined) {
		fields.push('name = ?');
		params.push(input.name);
	}
	if (input.slug !== undefined) {
		fields.push('slug = ?');
		params.push(input.slug);
	}
	if (input.category_slug !== undefined) {
		fields.push('category_id = ?');
		params.push(await resolveCategoryId(db, input.category_slug));
	}
	if (input.brand_slug !== undefined) {
		fields.push('brand_id = ?');
		params.push(await resolveBrandId(db, input.brand_slug));
	}
	if (input.release_year !== undefined) {
		fields.push('release_year = ?');
		params.push(input.release_year);
	}
	if (input.description !== undefined) {
		fields.push('description = ?');
		params.push(input.description);
	}
	if (input.image_url !== undefined) {
		fields.push('image_url = ?');
		params.push(input.image_url);
	}
	if (input.wax_type !== undefined) {
		fields.push('wax_type = ?');
		params.push(input.wax_type);
	}
	if (input.vessel_material !== undefined) {
		fields.push('vessel_material = ?');
		params.push(input.vessel_material);
	}
	if (input.is_discontinued !== undefined) {
		fields.push('is_discontinued = ?');
		params.push(input.is_discontinued ? 1 : 0);
	}

	if (fields.length > 0) {
		fields.push(`updated_at = CURRENT_TIMESTAMP`);
		params.push(id);
		await execute(db, `UPDATE products SET ${fields.join(', ')} WHERE id = ?`, ...params);
	}

	if (input.scent_summary !== undefined || input.notes !== undefined || input.accords !== undefined) {
		await upsertScentProfile(db, id, input.scent_summary, input.notes, input.accords);
	}

	if (input.images !== undefined) {
		for (const image of input.images) {
			if (!isValidImageKeyForProduct(id, image.r2_key)) {
				throw new Error(`Invalid image key for product: ${image.r2_key}`);
			}
		}
		const result = await setProductImages(db, id, input.images);
		removedImageKeys = result.removedKeys;
	}

	if (input.sizes !== undefined) {
		await setProductSizes(db, id, input.sizes);
	}

	await rebuildProductSearch(db, id);
	const product = await getProductById(db, id);
	return { product, removedImageKeys };
}

export async function setProductRating(
	db: Db,
	productId: string,
	input: { rating_avg?: number; rating_count: number },
): Promise<void> {
	await execute(
		db,
		`INSERT INTO product_rating_summaries (product_id, rating_avg, rating_count)
		 VALUES (?, ?, ?)
		 ON CONFLICT(product_id) DO UPDATE SET
			rating_avg = excluded.rating_avg,
			rating_count = excluded.rating_count,
			updated_at = CURRENT_TIMESTAMP`,
		productId,
		input.rating_avg ?? null,
		input.rating_count,
	);
}

export async function deleteProduct(
	db: Db,
	id: string,
	publicBaseUrl: string,
): Promise<{ deleted: boolean; r2Keys: string[] }> {
	const existing = await getProductById(db, id);
	if (!existing) return { deleted: false, r2Keys: [] };

	const images = await listProductImages(db, id, publicBaseUrl);
	const r2Keys = images.map((image) => image.r2_key);

	await execute(db, `DELETE FROM product_search WHERE product_id = ?`, id);

	const profile = await queryOne<{ id: string }>(
		db,
		`SELECT id FROM scent_profiles WHERE product_id = ?`,
		id,
	);
	if (profile) {
		await execute(db, `DELETE FROM scent_profile_notes WHERE scent_profile_id = ?`, profile.id);
		await execute(db, `DELETE FROM scent_profile_accords WHERE scent_profile_id = ?`, profile.id);
		await execute(db, `DELETE FROM scent_profiles WHERE id = ?`, profile.id);
	}

	await execute(db, `DELETE FROM product_vote_aggregates WHERE product_id = ?`, id);
	await execute(db, `DELETE FROM product_rating_summaries WHERE product_id = ?`, id);
	await execute(db, `DELETE FROM product_sizes WHERE product_id = ?`, id);
	await execute(
		db,
		`DELETE FROM product_reminds_me_of WHERE product_id = ? OR reminded_product_id = ?`,
		id,
		id,
	);
	await execute(db, `DELETE FROM reviews WHERE product_id = ?`, id);
	await execute(db, `DELETE FROM products WHERE id = ?`, id);

	return { deleted: true, r2Keys };
}

export async function deleteProducts(
	db: Db,
	ids: string[],
	publicBaseUrl: string,
): Promise<{ deleted: string[]; notFound: string[]; r2Keys: string[] }> {
	const deleted: string[] = [];
	const notFound: string[] = [];
	const r2Keys: string[] = [];

	for (const id of ids) {
		const result = await deleteProduct(db, id, publicBaseUrl);
		if (result.deleted) {
			deleted.push(id);
			r2Keys.push(...result.r2Keys);
		} else {
			notFound.push(id);
		}
	}

	return { deleted, notFound, r2Keys };
}
