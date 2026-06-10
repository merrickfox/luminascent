import type { Brand } from '../brands/types';

export type ImportProductStatus = 'created' | 'updated' | 'skipped' | 'failed';

export type RefEnsureCounts = {
	created: number;
	existing: number;
};

export type ImageImportDetail = {
	url: string;
	outcome: 'uploaded' | 'failed';
	r2_key?: string;
	http_status?: number | null;
	content_type?: string;
	bytes?: number;
	user_agent?: string;
	error?: string;
};

export type ImportImageStats = {
	requested: number;
	added: number;
	kept: number;
	failed: { url: string; error: string }[];
	details: ImageImportDetail[];
};

export type ImportProductResult = {
	status: ImportProductStatus;
	productId?: string;
	slug: string;
	notes: RefEnsureCounts;
	accords: RefEnsureCounts;
	images: ImportImageStats;
	warnings: string[];
	error?: string;
};

export type EnsureBrandResult = {
	brand: Brand;
	status: 'existing' | 'created';
};

export type ImportOptions = {
	update_existing: boolean;
	refetch_images: boolean;
};
