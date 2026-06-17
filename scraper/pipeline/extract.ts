import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type {
  ExtractBatchStats,
  ExtractProductStats,
  FieldType,
  LlmInput,
  LlmInputDerivedTarget,
  LlmOutput,
  SchemaDefinition,
  SchemaField,
  SchemaStructuredScope,
} from './types.js';
import { elapsedMs } from './timing.js';
import { hashContent } from './hash.js';
import { slugify } from './slug.js';
import type { LlmProvider } from './providers/types.js';

const SYSTEM_PROMPT = `You extract a single structured field from scraped web page text.
Return ONLY valid JSON with a top-level "value" key. No markdown, no explanation.
For single cardinality: value is a string, number, boolean, or null.
For multiple cardinality: value is a JSON array.
If the requested information is not present, return {"value": null} or {"value": []}.`;

function normalizeRawValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join('\n');
  }
  return String(value ?? '');
}

function parseLlmJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('LLM response is not valid JSON');
  }
}

function coerceScalar(value: unknown, type: FieldType): unknown {
  if (value === null || value === undefined || value === '') return null;

  switch (type) {
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.round(value);
      }
      const str = String(value).replace(/,/g, '').trim();
      const match = str.match(/-?\d+(?:\.\d+)?/);
      if (!match) return null;
      const num = Number(match[0]);
      return Number.isFinite(num) ? Math.round(num) : null;
    }
    case 'currency': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      const str = String(value).replace(/,/g, '').trim();
      const match = str.match(/-?\d+(?:\.\d+)?/);
      if (!match) return null;
      const num = Number(match[0]);
      if (!Number.isFinite(num)) return null;
      if (str.includes('.') || /[£$€]/.test(str)) {
        return Math.round(num * 100);
      }
      return num;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      return ['true', 'yes', '1'].includes(String(value).toLowerCase());
    case 'url':
    case 'text':
      return String(value).trim() || null;
    default:
      return value;
  }
}

function coerceValue(value: unknown, field: SchemaField): unknown {
  if (field.cardinality === 'multiple') {
    const arr = Array.isArray(value) ? value : value == null ? [] : [value];
    return arr.map((item) => coerceScalar(item, field.type)).filter((item) => item != null && item !== '');
  }
  return coerceScalar(value, field.type);
}

function buildFieldPrompt(field: SchemaField, rawValue: string): string {
  const instruction = field.llm?.instruction ?? `Extract ${field.label}.`;
  return [
    `Field: ${field.label} (${field.key})`,
    `Type: ${field.type}`,
    `Cardinality: ${field.cardinality}`,
    `Instruction: ${instruction}`,
    '',
    'Raw value from page:',
    '"""',
    rawValue.slice(0, 12000),
    '"""',
    '',
    'Return JSON: {"value": ...}',
  ].join('\n');
}

function buildDerivedPrompt(
  field: SchemaField,
  parentFieldKey: string,
  parentValue: string,
  confidence: 'also' | 'sometimes',
): string {
  const instruction = field.llm?.instruction ?? `Extract ${field.label} from the parent text.`;
  const optionalNote =
    confidence === 'sometimes'
      ? 'This field may not be present. Return {"value": null} if not found.'
      : '';

  return [
    `Extract embedded field from parent text.`,
    `Target field: ${field.label} (${field.key})`,
    `Parent field: ${parentFieldKey}`,
    `Type: ${field.type}`,
    `Cardinality: ${field.cardinality}`,
    `Instruction: ${instruction}`,
    optionalNote,
    '',
    'Parent raw value:',
    '"""',
    parentValue.slice(0, 12000),
    '"""',
    '',
    'Return JSON: {"value": ...}',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Field keys owned by a structured scope — extracted together, not field-by-field. */
function structuredScopeFieldKeys(schema: SchemaDefinition): Set<string> {
  const keys = new Set<string>();
  for (const scope of schema.structuredScopes ?? []) {
    for (const item of scope.items) keys.add(item.fieldKey);
  }
  return keys;
}

/**
 * Find the raw text holding a scope's items: the directly-tagged source field,
 * or — when the items are only ever embedded in another field (containment) —
 * the parent text that field derives from.
 */
function resolveScopeSource(
  scope: SchemaStructuredScope,
  parentValues: Map<string, string>,
  derivedTargets: LlmInputDerivedTarget[],
): string | null {
  const direct = parentValues.get(scope.source);
  if (direct && direct.trim()) return direct;

  for (const target of derivedTargets) {
    if (target.fieldKey !== scope.source) continue;
    const parent = parentValues.get(target.derive_from);
    if (parent && parent.trim()) return parent;
  }
  return null;
}

function buildStructuredScopePrompt(
  scope: SchemaStructuredScope,
  fieldMap: Map<string, SchemaField>,
  sourceText: string,
): string {
  const itemLines = scope.items.map((item) => {
    const field = fieldMap.get(item.fieldKey);
    const enumNote = item.enum ? ` (one of: ${item.enum.join(', ')})` : '';
    const guidance = field?.llm?.instruction ?? field?.label ?? item.as;
    return `- "${item.as}" (${field?.type ?? 'text'})${enumNote}: ${guidance}`;
  });

  return [
    `Extract the "${scope.scope}" items from the source text as a JSON array of objects.`,
    `Each object MUST have exactly these keys:`,
    ...itemLines,
    '',
    scope.instruction,
    '',
    'Source text:',
    '"""',
    sourceText.slice(0, 12000),
    '"""',
    '',
    'Return JSON: {"value": [ { ... }, ... ]}',
  ].join('\n');
}

/**
 * Split one array of objects into aligned per-field arrays. The scope's `source`
 * field is the anchor: rows without an anchor value are dropped, and every other
 * attribute keeps the dropped/empty slots as null so indexes stay aligned with
 * the anchor (assemble.ts zips these by index).
 */
function applyStructuredScope(
  scope: SchemaStructuredScope,
  fieldMap: Map<string, SchemaField>,
  llmValue: unknown,
  fields: Record<string, unknown>,
): void {
  const rows = (Array.isArray(llmValue) ? llmValue : []).filter(
    (row): row is Record<string, unknown> => row != null && typeof row === 'object',
  );
  const anchor = scope.items.find((item) => item.fieldKey === scope.source) ?? scope.items[0];
  if (!anchor) return;

  const coerceItem = (item: SchemaStructuredScope['items'][number], raw: unknown): unknown => {
    const field = fieldMap.get(item.fieldKey);
    const value = coerceScalar(raw, field?.type ?? 'text');
    if (value == null) return null;
    if (item.enum) {
      const lowered = String(value).toLowerCase();
      const normalized = item.synonyms?.[lowered] ?? lowered;
      return item.enum.includes(normalized) ? normalized : null;
    }
    return value;
  };

  const byField: Record<string, unknown[]> = {};
  for (const item of scope.items) byField[item.fieldKey] = [];

  for (const row of rows) {
    const anchorValue = coerceItem(anchor, row[anchor.as]);
    if (anchorValue == null || anchorValue === '') continue;
    for (const item of scope.items) {
      byField[item.fieldKey].push(coerceItem(item, row[item.as]));
    }
  }

  for (const item of scope.items) {
    const values = byField[item.fieldKey];
    if (values.some((value) => value != null)) {
      fields[item.fieldKey] = values;
    }
  }
}

async function callFieldLlm(
  provider: LlmProvider,
  prompt: string,
  retries = 1,
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await provider.complete({
        system: SYSTEM_PROMPT,
        prompt,
        jsonMode: true,
      });
      const parsed = parseLlmJson(raw) as { value?: unknown };
      return parsed.value;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('LLM call failed');
}

function deriveDeterministic(field: SchemaField, fields: Record<string, unknown>): unknown {
  switch (field.key) {
    case 'slug':
      return fields.name ? slugify(String(fields.name)) : null;
    case 'brand_slug':
      return fields.brand_name ? slugify(String(fields.brand_name)) : null;
    case 'note_slug': {
      const names = fields.note_name;
      if (!Array.isArray(names)) return null;
      return names.map((name) => slugify(String(name)));
    }
    case 'accord_slug': {
      const names = fields.accord_name;
      if (!Array.isArray(names)) return null;
      return names.map((name) => slugify(String(name)));
    }
    case 'source_url':
      return fields.source_url ?? null;
    default:
      return null;
  }
}

function getFieldMap(schema: SchemaDefinition): Map<string, SchemaField> {
  return new Map(schema.fields.map((field) => [field.key, field]));
}

function shouldSkipLlm(field: SchemaField): boolean {
  return field.llm?.deterministic === true;
}

export function loadLlmInput(path: string): LlmInput {
  return JSON.parse(readFileSync(path, 'utf-8')) as LlmInput;
}

export function isOutputCurrent(llmInputPath: string, llmOutputPath: string): boolean {
  if (!existsSync(llmOutputPath)) return false;
  const inputHash = hashContent(readFileSync(llmInputPath, 'utf-8'));
  const output = JSON.parse(readFileSync(llmOutputPath, 'utf-8')) as LlmOutput;
  return output.inputHash === inputHash;
}

function productSlugFromPaths(llmInputPath: string): string {
  return basename(dirname(llmInputPath));
}

export async function extractProduct(options: {
  llmInputPath: string;
  llmOutputPath: string;
  schema: SchemaDefinition;
  provider: LlmProvider;
  dryRun?: boolean;
}): Promise<{ output: LlmOutput; stats: ExtractProductStats }> {
  const started = process.hrtime.bigint();
  const productSlug = productSlugFromPaths(options.llmInputPath);
  let passes = 0;

  const inputContent = readFileSync(options.llmInputPath, 'utf-8');
  const llmInput = JSON.parse(inputContent) as LlmInput;
  const fieldMap = getFieldMap(options.schema);
  const fields: Record<string, unknown> = {
    source_url: llmInput.source_url,
  };
  const errors: Array<{ fieldKey: string; error: string }> = [];

  const finish = (output: LlmOutput): { output: LlmOutput; stats: ExtractProductStats } => ({
    output,
    stats: {
      productSlug,
      sourceUrl: llmInput.source_url,
      cached: false,
      passes,
      durationMs: elapsedMs(started),
      errors: errors.length,
    },
  });

  if (options.dryRun) {
    return finish({
      source_url: llmInput.source_url,
      inputHash: hashContent(inputContent),
      processedAt: new Date().toISOString(),
      fields,
    });
  }

  const parentValues = new Map<string, string>();
  for (const entry of llmInput.fields) {
    parentValues.set(entry.fieldKey, normalizeRawValue(entry.value));
  }

  const derivedKeys = new Set(llmInput.derived_targets.map((t) => t.fieldKey));
  const scopedKeys = structuredScopeFieldKeys(options.schema);

  for (const entry of llmInput.fields) {
    const schemaField = fieldMap.get(entry.fieldKey);
    if (!schemaField || shouldSkipLlm(schemaField)) continue;
    if (scopedKeys.has(entry.fieldKey)) continue;
    if (derivedKeys.has(entry.fieldKey) && schemaField.scope !== entry.scope) continue;

    try {
      const rawValue = normalizeRawValue(entry.value);
      if (!rawValue.trim()) continue;

      const prompt = buildFieldPrompt(schemaField, rawValue);
      passes += 1;
      const llmValue = await callFieldLlm(options.provider, prompt);
      fields[entry.fieldKey] = coerceValue(llmValue, schemaField);
    } catch (error) {
      errors.push({
        fieldKey: entry.fieldKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const target of llmInput.derived_targets) {
    const schemaField = fieldMap.get(target.fieldKey);
    if (!schemaField || shouldSkipLlm(schemaField)) continue;
    if (scopedKeys.has(target.fieldKey)) continue;

    const parentValue = parentValues.get(target.derive_from);
    if (!parentValue?.trim()) continue;

    if (fields[target.fieldKey] != null && fields[target.fieldKey] !== '') {
      continue;
    }

    try {
      const prompt = buildDerivedPrompt(
        schemaField,
        target.derive_from,
        parentValue,
        target.confidence,
      );
      passes += 1;
      const llmValue = await callFieldLlm(options.provider, prompt);
      const coerced = coerceValue(llmValue, schemaField);
      if (coerced != null && coerced !== '' && !(Array.isArray(coerced) && coerced.length === 0)) {
        fields[target.fieldKey] = coerced;
      }
    } catch (error) {
      errors.push({
        fieldKey: target.fieldKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const scope of options.schema.structuredScopes ?? []) {
    const sourceText = resolveScopeSource(scope, parentValues, llmInput.derived_targets);
    if (!sourceText?.trim()) continue;

    try {
      const prompt = buildStructuredScopePrompt(scope, fieldMap, sourceText);
      passes += 1;
      const llmValue = await callFieldLlm(options.provider, prompt);
      applyStructuredScope(scope, fieldMap, llmValue, fields);
    } catch (error) {
      errors.push({
        fieldKey: scope.source,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const schemaField of options.schema.fields) {
    if (!schemaField.llm?.deterministic) continue;
    const derived = deriveDeterministic(schemaField, fields);
    if (derived != null) {
      fields[schemaField.key] = derived;
    }
  }

  const output: LlmOutput = {
    source_url: llmInput.source_url,
    inputHash: hashContent(inputContent),
    processedAt: new Date().toISOString(),
    fields,
    ...(errors.length > 0 ? { errors } : {}),
  };

  writeFileSync(options.llmOutputPath, JSON.stringify(output, null, 2));
  return finish(output);
}

export async function runExtractionBatch(options: {
  products: Array<{ llmInputPath: string; llmOutputPath: string }>;
  schema: SchemaDefinition;
  provider: LlmProvider;
  concurrency: number;
  onlyNew: boolean;
  dryRun?: boolean;
  onProgress?: (done: number, total: number, stats: ExtractProductStats) => void;
}): Promise<{ outputs: LlmOutput[]; stats: ExtractBatchStats }> {
  const batchStarted = process.hrtime.bigint();
  const queue = [...options.products];
  const outputs: LlmOutput[] = [];
  const productStats: ExtractProductStats[] = [];
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const productSlug = productSlugFromPaths(item.llmInputPath);
      const cachedStarted = process.hrtime.bigint();

      if (options.onlyNew && isOutputCurrent(item.llmInputPath, item.llmOutputPath)) {
        const output = JSON.parse(readFileSync(item.llmOutputPath, 'utf-8')) as LlmOutput;
        outputs.push(output);
        const stats: ExtractProductStats = {
          productSlug,
          sourceUrl: output.source_url,
          cached: true,
          passes: 0,
          durationMs: elapsedMs(cachedStarted),
          errors: output.errors?.length ?? 0,
        };
        productStats.push(stats);
        done += 1;
        options.onProgress?.(done, options.products.length, stats);
        continue;
      }

      const { output, stats } = await extractProduct({
        ...item,
        schema: options.schema,
        provider: options.provider,
        dryRun: options.dryRun,
      });
      outputs.push(output);
      productStats.push(stats);
      done += 1;
      options.onProgress?.(done, options.products.length, stats);
    }
  }

  const workers = Array.from({ length: Math.max(1, options.concurrency) }, () => worker());
  await Promise.all(workers);

  const totalPasses = productStats.reduce((sum, s) => sum + s.passes, 0);
  const cached = productStats.filter((s) => s.cached).length;
  const errorCount = productStats.reduce((sum, s) => sum + s.errors, 0);

  return {
    outputs,
    stats: {
      products: productStats,
      totalDurationMs: elapsedMs(batchStarted),
      totalPasses,
      processed: productStats.length - cached,
      cached,
      errorCount,
    },
  };
}
