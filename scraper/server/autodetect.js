import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PIPELINE_CONFIG_PATH = path.join(ROOT, 'pipeline.config.json');

// Auto-detect hands a whole-page candidate outline to the model, so it needs a far
// larger context than the per-field extraction pass. Bump it unless the config overrides.
const DEFAULT_AUTODETECT_NUM_CTX = 32768;

function readPipelineConfig() {
  try {
    return JSON.parse(fs.readFileSync(PIPELINE_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// Fields the model is allowed to locate on the page. Mirrors what Product mode exposes
// for manual tagging: anything DOM-tagged. Deterministic fields (slugs, source_url) are
// computed later in the pipeline, and images are configured separately — never here.
function taggableFields(schema) {
  return (schema?.fields || []).filter(
    (field) => field.scope !== 'image' && !field.llm?.deterministic,
  );
}

function buildSystemPrompt() {
  return [
    'You map fields onto elements of a scraped product page.',
    'You are given a numbered list of candidate elements (each is one line: [index] tag.classes "text snippet") and a list of fields to find.',
    'For each field, decide which candidate index (or indices) holds that field\'s value on THIS page.',
    'You are classifying from a fixed list — only ever return indices that appear in the candidate list. Never invent indices, selectors, or text.',
    'It is fine to leave a field out: only return fields you can confidently locate. Best-effort beats guessing.',
    'Return ONLY valid JSON. No markdown, no commentary.',
  ].join('\n');
}

function buildUserPrompt(fields, outline, containmentModes) {
  const fieldLines = fields.map((field) => {
    const parts = [
      `- ${field.key} (${field.label})`,
      `scope=${field.scope}`,
      `type=${field.type}`,
      `cardinality=${field.cardinality}`,
    ];
    if (field.llm?.instruction) parts.push(`note: ${field.llm.instruction}`);
    return parts.join(' · ');
  });

  const hasAlso = (containmentModes || []).includes('also_contains');
  const hasSometimes = (containmentModes || []).includes('sometimes_contains');

  return [
    'FIELDS TO FIND:',
    fieldLines.join('\n'),
    '',
    'CONTAINMENT — some fields do not get their own element; they live INSIDE another field\'s text:',
    '- A currency symbol/code usually sits inside the price text; a unit (g, oz) usually sits inside the size text; individual notes are often listed inside the description.',
    'When a field is embedded like that, do NOT give it its own index. Instead attach its key to the containing field:',
    hasAlso ? '- "also_contains": keys that are ALWAYS present inside this field\'s element.' : '',
    hasSometimes ? '- "sometimes_contains": keys that are SOMETIMES present inside this field\'s element.' : '',
    '',
    'CANDIDATES:',
    outline.join('\n'),
    '',
    'Respond with JSON of this exact shape:',
    '{"fields": [',
    '  {"fieldKey": "name", "candidateIndices": [12]},',
    '  {"fieldKey": "price_amount", "candidateIndices": [37], "also_contains": ["price_currency"]},',
    '  {"fieldKey": "description", "candidateIndices": [58], "sometimes_contains": ["note_name"]}',
    ']}',
    'Use candidateIndices as an array (one entry for single fields, several only when a field genuinely repeats across elements).',
    'Omit any field you cannot locate. Omit also_contains/sometimes_contains when empty.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

async function callOllama({ baseUrl, model, numCtx, system, prompt }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/api/chat`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: { num_ctx: numCtx },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content = data?.message?.content?.trim();
  if (!content) throw new Error('Ollama returned empty response');
  return content;
}

// Keep the raw model output honest: drop anything that doesn't name a real taggable
// field or point at an in-range candidate. This is the seam where LLM noise is filtered
// before it reaches the userscript and gets turned into locators.
function sanitizeFields(raw, fields, outlineLength) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const seen = new Set();
  const out = [];

  for (const entry of Array.isArray(raw) ? raw : []) {
    const fieldKey = entry?.fieldKey;
    if (!byKey.has(fieldKey) || seen.has(fieldKey)) continue;

    const indices = []
      .concat(entry.candidateIndices ?? entry.candidateIndex ?? [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < outlineLength);
    const uniqueIndices = [...new Set(indices)];
    if (!uniqueIndices.length) continue;

    const validContained = (keys) =>
      [...new Set((Array.isArray(keys) ? keys : []).filter((k) => byKey.has(k) && k !== fieldKey))];

    seen.add(fieldKey);
    out.push({
      fieldKey,
      scope: byKey.get(fieldKey).scope,
      type: byKey.get(fieldKey).type,
      candidateIndices: uniqueIndices,
      also_contains: validContained(entry.also_contains),
      sometimes_contains: validContained(entry.sometimes_contains),
    });
  }

  return out;
}

// Run a best-effort field-location pass over a page outline. Returns
// { fields, provider, model } where each field carries candidate indices into the
// outline plus any contained sub-fields. Throws on provider/transport errors so the
// caller can surface a clean status.
export async function detectFields({ outline, schema }) {
  if (!Array.isArray(outline) || !outline.length) {
    return { fields: [], provider: null, model: null };
  }

  const pipeline = readPipelineConfig();
  const provider = pipeline.provider || 'ollama';
  const model = pipeline.model || 'qwen3-coder:30b';
  const baseUrl = pipeline.baseUrl || 'http://localhost:11434';
  const numCtx = pipeline.autodetectNumCtx || DEFAULT_AUTODETECT_NUM_CTX;

  if (provider === 'claude') {
    throw new Error(
      'Claude provider not yet implemented for auto-detect. Set provider "ollama" in pipeline.config.json.',
    );
  }

  const fields = taggableFields(schema);
  const system = buildSystemPrompt();
  const prompt = buildUserPrompt(fields, outline, schema?.containmentModes);

  const content = await callOllama({ baseUrl, model, numCtx, system, prompt });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Could not parse model response as JSON: ${err.message}`);
  }

  const rawFields = Array.isArray(parsed) ? parsed : parsed?.fields;
  return {
    fields: sanitizeFields(rawFields, fields, outline.length),
    provider,
    model,
  };
}
