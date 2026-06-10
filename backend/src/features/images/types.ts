export type ProductImage = {
	id: string;
	product_id: string;
	r2_key: string;
	position: number;
	is_primary: number;
	created_at: string;
};

export type ProductImageResponse = {
	id: string;
	r2_key: string;
	url: string;
	position: number;
	is_primary: boolean;
};

export type ProductImageInput = {
	r2_key: string;
	position?: number;
	is_primary?: boolean;
};
