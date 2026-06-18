export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type Review = {
	id: string;
	product_id: string;
	user_id: string | null;
	author_name: string | null;
	rating: number | null;
	title: string | null;
	body: string;
	language: string | null;
	helpful_count: number | null;
	unhelpful_count: number | null;
	status: ReviewStatus;
	moderated_at: string | null;
	moderation_note: string | null;
	published_at: string | null;
	created_at: string;
};

/** A review enriched with product + author details for the admin queue. */
export type AdminReview = Review & {
	product_name: string;
	product_slug: string;
	user_username: string | null;
	user_email: string | null;
};

export type ReviewCounts = { pending: number; approved: number; rejected: number };
