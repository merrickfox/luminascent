export type FieldScope = 'product' | 'size' | 'note' | 'accord' | 'image';
export type FieldType = 'text' | 'number' | 'currency' | 'boolean' | 'url';
export type FieldCardinality = 'single' | 'multiple';

export interface SchemaLlmConfig {
  instruction: string;
  examples?: string[];
  optional?: boolean;
  deterministic?: boolean;
}

export interface SchemaField {
  key: string;
  label: string;
  scope: FieldScope;
  cardinality: FieldCardinality;
  type: FieldType;
  required?: boolean;
  mapsTo?: string;
  /** Hard cap on emitted values for multiple-cardinality fields (extra values are dropped). */
  maxItems?: number;
  llm?: SchemaLlmConfig;
}

export interface SchemaStructuredScopeItem {
  /** Schema field this object key feeds into (e.g. note_name, note_pyramid_stage). */
  fieldKey: string;
  /** JSON key the LLM returns for this attribute on each object. */
  as: string;
  /** Optional allowed values; out-of-set values are dropped to null. */
  enum?: string[];
  /** Optional lowercase synonym -> canonical value, applied before the enum check. */
  synonyms?: Record<string, string>;
}

/**
 * A scope extracted as a single LLM pass returning an array of objects, instead
 * of independent parallel-array fields. Keeps per-item attributes (e.g. a note's
 * pyramid stage) aligned with their owner, since they come from one call.
 */
export interface SchemaStructuredScope {
  scope: FieldScope;
  /** Field key whose tagged/contained raw text holds the items. */
  source: string;
  /** Shared guidance for the whole extraction. */
  instruction: string;
  items: SchemaStructuredScopeItem[];
}

export interface SchemaDefinition {
  name: string;
  version: number;
  description?: string;
  fields: SchemaField[];
  containmentModes?: string[];
  structuredScopes?: SchemaStructuredScope[];
}

export interface PipelineConfig {
  provider: string;
  model: string;
  baseUrl: string;
  schema: string;
  concurrency: number;
  numCtx: number;
  numPredict: number;
  defaults?: {
    category_slug?: string;
  };
  push?: {
    backendUrl?: string;
    apiKey?: string;
  };
}

export interface SitePipelineConfig {
  brand_name?: string;
  brand_slug?: string;
  category_slug?: string;
}

export interface LlmInputField {
  fieldKey: string;
  scope: FieldScope;
  type: FieldType;
  value: string | string[];
  also_contains: Array<{ fieldKey: string; scope: FieldScope; type: FieldType; label: string }>;
  sometimes_contains: Array<{ fieldKey: string; scope: FieldScope; type: FieldType; label: string }>;
}

export interface LlmInputDerivedTarget {
  fieldKey: string;
  scope: FieldScope;
  type: FieldType;
  derive_from: string;
  confidence: 'also' | 'sometimes';
}

export interface LlmInputImage {
  source_url: string;
  position: number;
  is_primary: boolean;
}

export interface LlmInput {
  source_url: string;
  schema: string;
  schema_version: number;
  generatedAt: string;
  fields: LlmInputField[];
  derived_targets: LlmInputDerivedTarget[];
  images: LlmInputImage[];
}

export interface LlmOutput {
  source_url: string;
  inputHash: string;
  processedAt: string;
  fields: Record<string, unknown>;
  errors?: Array<{ fieldKey: string; error: string }>;
}

export interface ExtractProductStats {
  productSlug: string;
  sourceUrl: string;
  cached: boolean;
  passes: number;
  durationMs: number;
  errors: number;
}

export interface ExtractBatchStats {
  products: ExtractProductStats[];
  totalDurationMs: number;
  totalPasses: number;
  processed: number;
  cached: number;
  errorCount: number;
}

export interface ScrapedImageRecord {
  source_url?: string;
  position: number;
  is_primary: boolean;
  file?: string;
  data_base64?: string;
  content_type?: string;
}

export interface ScrapedProductRecord {
  source_url?: string;
  category_slug: string;
  brand_name?: string;
  brand_slug?: string;
  name: string;
  slug?: string;
  description?: string | null;
  scent_summary?: string | null;
  release_year?: number | null;
  wax_type?: string | null;
  vessel_material?: string | null;
  is_discontinued?: boolean;
  sizes?: Array<Record<string, unknown>>;
  images?: ScrapedImageRecord[];
  notes?: Array<Record<string, unknown>>;
  accords?: Array<Record<string, unknown>>;
  _productSlug?: string;
}

export interface HostConfig {
  host: string;
  hostSlug: string;
}
