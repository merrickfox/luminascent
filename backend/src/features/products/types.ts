import type { Accord } from '../accords/types';
import type { Brand } from '../brands/types';
import type { Category } from '../categories/types';
import type { Note } from '../notes/types';
import type { RemindsMeOf } from '../reminds/types';
import type { Review } from '../reviews/types';
import type { VoteAggregate } from '../votes/types';
import type { ProductImageResponse } from '../images/types';
import type { ProductSize } from '../sizes/types';

export type Product = {
	id: string;
	category_id: string;
	brand_id: string | null;
	name: string;
	slug: string;
	release_year: number | null;
	description: string | null;
	image_url: string | null;
	wax_type: string | null;
	vessel_material: string | null;
	is_discontinued: number;
	created_at: string;
	updated_at: string;
};

export type ScentProfile = {
	id: string;
	product_id: string;
	summary: string | null;
	created_at: string;
	updated_at: string;
};

export type ScentProfileNote = {
	note: Note;
	pyramid_stage: string | null;
	position_index: number | null;
};

export type ScentProfileAccord = {
	accord: Accord;
	strength_score: number | null;
	position_index: number | null;
};

export type ProductRatingSummary = {
	product_id: string;
	rating_avg: number | null;
	rating_count: number;
	updated_at: string;
};

export type ProductDetail = {
	product: Product;
	category: Category;
	brand: Brand | null;
	scent_profile: ScentProfile | null;
	notes: ScentProfileNote[];
	accords: ScentProfileAccord[];
	votes: VoteAggregate[];
	rating: ProductRatingSummary | null;
	reminds: RemindsMeOf[];
	reviews: Review[];
	images: ProductImageResponse[];
	sizes: ProductSize[];
};

export type ProductListFilters = {
	category?: string;
	brand?: string;
	notes?: string[];
	accords?: string[];
	vote_options?: string[];
	min_rating?: number;
	limit?: number;
	offset?: number;
	sort?: 'name' | 'rating' | 'newest';
};
