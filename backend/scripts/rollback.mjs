#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const confirmed = args.includes('--yes');

if (remote && !confirmed) {
	console.error('Remote rollback requires --yes confirmation.');
	console.error('Usage: npm run db:rollback:remote -- --yes');
	process.exit(1);
}

const target = remote ? '--remote' : '--local';
const downDir = join(process.cwd(), 'migrations', 'down');

const result = execSync(
	`npx wrangler d1 execute luminascent ${target} --command="SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1;" --json`,
	{ encoding: 'utf8', cwd: process.cwd() },
);

let lastMigration;
try {
	const parsed = JSON.parse(result);
	const row = parsed?.[0]?.results?.[0];
	lastMigration = row?.name;
} catch {
	console.error('Failed to parse migration status.');
	process.exit(1);
}

if (!lastMigration) {
	console.log('No applied migrations to roll back.');
	process.exit(0);
}

const baseName = lastMigration.replace('.sql', '');
const downPath = join(downDir, `${baseName}.down.sql`);

if (!existsSync(downPath)) {
	console.error(`Down migration not found: ${downPath}`);
	process.exit(1);
}

console.log(`Rolling back: ${lastMigration}`);
console.log(`Running: ${downPath}`);

execSync(`npx wrangler d1 execute luminascent ${target} --file=${downPath}`, {
	stdio: 'inherit',
	cwd: process.cwd(),
});

execSync(
	`npx wrangler d1 execute luminascent ${target} --command="DELETE FROM d1_migrations WHERE name = '${lastMigration}';"`,
	{ stdio: 'inherit', cwd: process.cwd() },
);

console.log(`Rolled back ${lastMigration}. Re-run db:apply to re-apply.`);
