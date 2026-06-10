export type RemindsMeOf = {
	product_id: string;
	reminded_product_id: string | null;
	external_brand_name: string | null;
	external_product_name: string | null;
	external_source_url: string | null;
	thumbs_up: number;
	thumbs_down: number;
	created_at: string;
};
