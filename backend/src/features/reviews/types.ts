export type Review = {
	id: string;
	product_id: string;
	author_name: string | null;
	rating: number | null;
	title: string | null;
	body: string;
	language: string | null;
	helpful_count: number | null;
	unhelpful_count: number | null;
	published_at: string | null;
	created_at: string;
};
