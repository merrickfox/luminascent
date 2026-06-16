#!/usr/bin/env node
import { listHostSlugs } from './discover.js';
import { resolveProducts } from './discover.js';
import {
  loadPipelineConfig,
  loadSchema,
  resolveSiteBrand,
} from './config.js';
import { createProvider } from './providers/index.js';
import { runExtractionBatch } from './extract.js';
import { assembleAndWrite } from './assemble.js';
import { pushSiteProducts } from './push.js';
import { formatDuration } from './timing.js';
import type { ExtractBatchStats } from './types.js';

function siteBrandOverrides(flags: Record<string, string | boolean>): {
  brand_name?: string;
  brand_slug?: string;
  category_slug?: string;
} {
  return {
    ...(typeof flags['brand-name'] === 'string' ? { brand_name: flags['brand-name'] } : {}),
    ...(typeof flags['brand-slug'] === 'string' ? { brand_slug: flags['brand-slug'] } : {}),
    ...(typeof flags['category-slug'] === 'string' ? { category_slug: flags['category-slug'] } : {}),
  };
}

function formatProductLine(done: number, total: number, stats: ExtractBatchStats['products'][number]): string {
  const passLabel = stats.cached ? 'cached' : `${stats.passes} pass${stats.passes === 1 ? '' : 'es'}`;
  const errorLabel = stats.errors > 0 ? `, ${stats.errors} error${stats.errors === 1 ? '' : 's'}` : '';
  return `  [${done}/${total}] ${stats.productSlug} — ${passLabel}, ${formatDuration(stats.durationMs)}${errorLabel}`;
}

function formatBatchSummary(label: string, stats: ExtractBatchStats, assembled: number): string {
  return (
    `[${label}] Done: ${stats.products.length} product(s), ${stats.totalPasses} pass(es), ` +
    `${formatDuration(stats.totalDurationMs)} (${stats.processed} processed, ${stats.cached} cached, ${stats.errorCount} field error(s), ${assembled} assembled)`
  );
}

function printUsage() {
  console.log(`Usage: pipeline <command> [options]

Commands:
  run    LLM pass + assemble products.json
  push   Push products.json + local images to backend

Run options:
  --all-brands          Process every site under sites/
  --brand <host_slug>   Target one site (default: all sites)
  --product <slug>      Target one product (requires --brand)
  --only-new            Skip products with up-to-date llm_output.json (default)
  --reprocess, --force  Reprocess all products
  --fresh               Replace products.json with only what this run assembles (default: upsert)
  --brand-name <name>   Override brand display name for assemble/push
  --brand-slug <slug>   Override brand slug for assemble/push
  --provider <name>     LLM provider (ollama, claude)
  --model <name>        Model name
  --base-url <url>      Provider base URL
  --concurrency <n>     Parallel product workers
  --dry-run             Skip LLM calls

Push options:
  --brand <host_slug>   Site to push (required unless --all-brands)
  --all-brands          Push every site with products.json
  --product <slug>      Push one product by slug
  --backend-url <url>   Backend API base URL
  --api-key <key>       Admin API key (x-api-key)
  --brand-name <name>   Override brand display name
  --brand-slug <slug>   Override brand slug
  --no-update           Do not update existing products
  --refetch-images      Re-fetch/re-upload images for existing products
`);
}

function parseArgs(argv: string[]) {
  const args = [...argv];
  const command = args.shift();

  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[0];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        args.shift();
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

async function runCommand(flags: Record<string, string | boolean>) {
  const config = loadPipelineConfig();
  if (typeof flags.provider === 'string') config.provider = flags.provider;
  if (typeof flags.model === 'string') config.model = flags.model;
  if (typeof flags['base-url'] === 'string') config.baseUrl = flags['base-url'];
  if (typeof flags.concurrency === 'string') config.concurrency = Number(flags.concurrency);

  const onlyNew = !(flags.reprocess === true || flags.force === true);
  const fresh = flags.fresh === true;
  const dryRun = flags['dry-run'] === true;
  const allBrands = flags['all-brands'] === true;
  const brand = typeof flags.brand === 'string' ? flags.brand : undefined;
  const product = typeof flags.product === 'string' ? flags.product : undefined;

  const products = resolveProducts({ allBrands: allBrands || !brand, brand, product });
  if (products.length === 0) {
    console.log('No products found to process.');
    return;
  }

  const schema = loadSchema(config.schema);
  const provider = createProvider(config);

  console.log(
    `Processing ${products.length} product(s) with ${config.provider}/${config.model} (onlyNew=${onlyNew}, fresh=${fresh})`,
  );

  const byHost = new Map<string, typeof products>();
  for (const ref of products) {
    const list = byHost.get(ref.hostSlug) ?? [];
    list.push(ref);
    byHost.set(ref.hostSlug, list);
  }

  const runStarted = process.hrtime.bigint();
  let grandTotalProducts = 0;
  let grandTotalPasses = 0;
  let grandTotalCached = 0;
  let grandTotalErrors = 0;
  let grandTotalAssembled = 0;

  for (const [hostSlug, hostProducts] of byHost) {
    console.log(`\n[${hostSlug}] Extracting ${hostProducts.length} product(s)...`);

    const { stats } = await runExtractionBatch({
      products: hostProducts.map((p) => ({
        llmInputPath: p.llmInputPath,
        llmOutputPath: p.llmOutputPath,
      })),
      schema,
      provider,
      concurrency: config.concurrency,
      onlyNew,
      dryRun,
      onProgress: (done, total, productStats) => {
        console.log(formatProductLine(done, total, productStats));
      },
    });

    const siteDefaults = resolveSiteBrand(hostSlug, siteBrandOverrides(flags));
    const { outputPath, assembled, total, mode } = assembleAndWrite({
      hostSlug,
      schema,
      siteDefaults,
      pipelineDefaults: config.defaults,
      productSlugs: hostProducts.map((p) => p.productSlug),
      fresh,
    });

    if (mode === 'fresh') {
      console.log(`  Wrote ${assembled} product(s) to ${outputPath} (fresh — replaced file)`);
    } else {
      console.log(`  Upserted ${assembled} product(s) into ${outputPath} (${total} total)`);
    }
    console.log(formatBatchSummary(hostSlug, stats, assembled));

    grandTotalProducts += stats.products.length;
    grandTotalPasses += stats.totalPasses;
    grandTotalCached += stats.cached;
    grandTotalErrors += stats.errorCount;
    grandTotalAssembled += assembled;
  }

  if (byHost.size > 0) {
    const grandDurationMs = Number(process.hrtime.bigint() - runStarted) / 1_000_000;
    console.log(
      `\nAll done: ${grandTotalProducts} product(s), ${grandTotalPasses} pass(es), ` +
        `${formatDuration(grandDurationMs)} (${grandTotalCached} cached, ${grandTotalErrors} field error(s), ${grandTotalAssembled} assembled)`,
    );
  }
}

async function pushCommand(flags: Record<string, string | boolean>) {
  const config = loadPipelineConfig();
  const allBrands = flags['all-brands'] === true;
  const brand = typeof flags.brand === 'string' ? flags.brand : undefined;
  const product = typeof flags.product === 'string' ? flags.product : undefined;

  const backendUrl =
    (typeof flags['backend-url'] === 'string' ? flags['backend-url'] : undefined) ??
    config.push?.backendUrl ??
    'http://localhost:8023';
  const apiKey =
    (typeof flags['api-key'] === 'string' ? flags['api-key'] : undefined) ??
    config.push?.apiKey ??
    'dev-admin-key';

  const hostSlugs = allBrands ? listHostSlugs() : brand ? [brand] : [];
  if (hostSlugs.length === 0) {
    throw new Error('push requires --brand <host_slug> or --all-brands');
  }

  for (const hostSlug of hostSlugs) {
    const siteBrand = resolveSiteBrand(hostSlug, siteBrandOverrides(flags));
    console.log(`\n[${hostSlug}] Pushing to ${backendUrl} (${siteBrand.brand_name} / ${siteBrand.brand_slug})...`);
    const results = await pushSiteProducts(config, {
      hostSlug,
      backendUrl,
      apiKey,
      updateExisting: flags['no-update'] !== true,
      refetchImages: flags['refetch-images'] === true,
      productSlug: product,
      siteBrand,
    });

    const failed = results.filter((r) => r.status === 'failed').length;
    console.log(`  Done: ${results.length - failed} ok, ${failed} failed`);
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || flags.help === true) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  try {
    switch (command) {
      case 'run':
        await runCommand(flags);
        break;
      case 'push':
        await pushCommand(flags);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
