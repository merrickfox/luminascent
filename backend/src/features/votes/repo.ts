import { execute, queryAll, queryOne, type Db } from '../../lib/db';
import { newId } from '../../lib/id';
import type { MyVote, VoteAggregate, VoteDimensionCatalog } from './types';

/**
 * Community vote aggregates for a product, derived from real per-user votes in
 * `product_votes`. Shape matches the legacy aggregate query so the product
 * detail assembly is unaffected.
 */
export async function getVoteAggregatesForProduct(db: Db, productId: string): Promise<VoteAggregate[]> {
	return queryAll<VoteAggregate>(
		db,
		`SELECT
			pv.product_id AS product_id,
			vo.id AS vote_option_id,
			COUNT(*) AS vote_count,
			vo.slug AS option_slug,
			vo.label AS option_label,
			vd.slug AS dimension_slug,
			vd.name AS dimension_name
		FROM product_votes pv
		JOIN vote_options vo ON vo.id = pv.vote_option_id
		JOIN vote_dimensions vd ON vd.id = vo.dimension_id
		WHERE pv.product_id = ?
		GROUP BY vo.id
		ORDER BY vd.slug, vo.sort_order`,
		productId,
	);
}

/** The current user's picks for a product, one per dimension they've voted in. */
export async function getUserVotesForProduct(db: Db, userId: string, productId: string): Promise<MyVote[]> {
	return queryAll<MyVote>(
		db,
		`SELECT vd.slug AS dimension_slug, vo.slug AS option_slug
		FROM product_votes pv
		JOIN vote_options vo ON vo.id = pv.vote_option_id
		JOIN vote_dimensions vd ON vd.id = pv.dimension_id
		WHERE pv.user_id = ? AND pv.product_id = ?`,
		userId,
		productId,
	);
}

async function resolveOption(
	db: Db,
	dimensionSlug: string,
	optionSlug: string,
): Promise<{ option_id: string; dimension_id: string }> {
	const row = await queryOne<{ option_id: string; dimension_id: string }>(
		db,
		`SELECT vo.id AS option_id, vo.dimension_id AS dimension_id
		FROM vote_options vo
		JOIN vote_dimensions vd ON vd.id = vo.dimension_id
		WHERE vd.slug = ? AND vo.slug = ?`,
		dimensionSlug,
		optionSlug,
	);
	if (!row) throw new Error(`Unknown vote option: ${dimensionSlug}/${optionSlug}`);
	return row;
}

async function resolveDimensionId(db: Db, dimensionSlug: string): Promise<string> {
	const row = await queryOne<{ id: string }>(db, `SELECT id FROM vote_dimensions WHERE slug = ?`, dimensionSlug);
	if (!row) throw new Error(`Unknown vote dimension: ${dimensionSlug}`);
	return row.id;
}

/** Cast or change the user's vote in a dimension (one vote per dimension). */
export async function castVote(
	db: Db,
	userId: string,
	productId: string,
	dimensionSlug: string,
	optionSlug: string,
): Promise<void> {
	const { option_id, dimension_id } = await resolveOption(db, dimensionSlug, optionSlug);
	await execute(
		db,
		`INSERT INTO product_votes (id, user_id, product_id, dimension_id, vote_option_id)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, product_id, dimension_id)
		 DO UPDATE SET vote_option_id = excluded.vote_option_id, updated_at = CURRENT_TIMESTAMP`,
		newId(),
		userId,
		productId,
		dimension_id,
		option_id,
	);
}

/** Remove the user's vote in a dimension. */
export async function removeUserVote(db: Db, userId: string, productId: string, dimensionSlug: string): Promise<void> {
	const dimensionId = await resolveDimensionId(db, dimensionSlug);
	await execute(
		db,
		`DELETE FROM product_votes WHERE user_id = ? AND product_id = ? AND dimension_id = ?`,
		userId,
		productId,
		dimensionId,
	);
}

/** All vote dimensions with their selectable options (the votable catalog). */
export async function getVoteDimensionCatalog(db: Db): Promise<VoteDimensionCatalog[]> {
	const rows = await queryAll<{
		dimension_slug: string;
		dimension_name: string;
		option_slug: string;
		option_label: string;
	}>(
		db,
		`SELECT vd.slug AS dimension_slug, vd.name AS dimension_name,
			vo.slug AS option_slug, vo.label AS option_label
		FROM vote_dimensions vd
		JOIN vote_options vo ON vo.dimension_id = vd.id
		ORDER BY vd.slug, vo.sort_order`,
	);

	const byDimension = new Map<string, VoteDimensionCatalog>();
	for (const row of rows) {
		let dim = byDimension.get(row.dimension_slug);
		if (!dim) {
			dim = { slug: row.dimension_slug, name: row.dimension_name, options: [] };
			byDimension.set(row.dimension_slug, dim);
		}
		dim.options.push({ slug: row.option_slug, label: row.option_label });
	}
	return [...byDimension.values()];
}

export async function setVoteAggregates(
	db: Db,
	productId: string,
	votes: { vote_option_slug: string; vote_count: number }[],
): Promise<void> {
	for (const vote of votes) {
		const option = await db
			.prepare(`SELECT id FROM vote_options WHERE slug = ?`)
			.bind(vote.vote_option_slug)
			.first<{ id: string }>();

		if (!option) {
			throw new Error(`Unknown vote option: ${vote.vote_option_slug}`);
		}

		await execute(
			db,
			`INSERT INTO product_vote_aggregates (product_id, vote_option_id, vote_count)
			 VALUES (?, ?, ?)
			 ON CONFLICT(product_id, vote_option_id) DO UPDATE SET vote_count = excluded.vote_count`,
			productId,
			option.id,
			vote.vote_count,
		);
	}
}
