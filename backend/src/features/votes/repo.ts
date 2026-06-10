import { execute, queryAll, type Db } from '../../lib/db';
import type { VoteAggregate } from './types';

export async function getVoteAggregatesForProduct(db: Db, productId: string): Promise<VoteAggregate[]> {
	return queryAll<VoteAggregate>(
		db,
		`SELECT
			pva.product_id,
			pva.vote_option_id,
			pva.vote_count,
			vo.slug AS option_slug,
			vo.label AS option_label,
			vd.slug AS dimension_slug,
			vd.name AS dimension_name
		FROM product_vote_aggregates pva
		JOIN vote_options vo ON vo.id = pva.vote_option_id
		JOIN vote_dimensions vd ON vd.id = vo.dimension_id
		WHERE pva.product_id = ?
		ORDER BY vd.slug, vo.sort_order`,
		productId,
	);
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
