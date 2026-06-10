export type ProductSize = {
	id: string;
	product_id: string;
	size_value: number | null;
	size_unit: string | null;
	size_grams: number | null;
	price_amount: number | null;
	price_currency: string | null;
	burn_time_hours: number | null;
	sku: string | null;
	availability: string | null;
	source_url: string | null;
	position: number;
	is_primary: number;
	created_at: string;
};

export type ProductSizeInput = {
	size_value?: number | null;
	size_unit?: string | null;
	size_grams?: number | null;
	price_amount?: number | null;
	price_currency?: string | null;
	burn_time_hours?: number | null;
	sku?: string | null;
	availability?: string | null;
	source_url?: string | null;
	position?: number;
	is_primary?: boolean;
};
