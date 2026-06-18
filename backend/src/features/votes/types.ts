export type VoteAggregate = {
	product_id: string;
	vote_option_id: string;
	vote_count: number;
	option_slug: string;
	option_label: string;
	dimension_slug: string;
	dimension_name: string;
};

/** A user's current pick within a dimension for a product. */
export type MyVote = {
	dimension_slug: string;
	option_slug: string;
};

export type VoteOptionCatalog = {
	slug: string;
	label: string;
};

/** A vote dimension with its selectable options (the votable catalog). */
export type VoteDimensionCatalog = {
	slug: string;
	name: string;
	options: VoteOptionCatalog[];
};
