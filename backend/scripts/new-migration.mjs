#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];

if (!name) {
	console.error('Usage: npm run db:new -- <migration_name>');
	process.exit(1);
}

if (!/^[a-z][a-z0-9_]*$/.test(name)) {
	console.error('Migration name must be snake_case starting with a letter.');
	process.exit(1);
}

const migrationsDir = join(process.cwd(), 'migrations');
const downDir = join(migrationsDir, 'down');

mkdirSync(downDir, { recursive: true });

execSync(`npx wrangler d1 migrations create luminascent ${name}`, {
	stdio: 'inherit',
	cwd: process.cwd(),
});

const upFiles = execSync(`ls -1 ${migrationsDir}/*.sql 2>/dev/null | sort`, {
	encoding: 'utf8',
})
	.trim()
	.split('\n')
	.filter((f) => f && !f.includes('/down/'));

const latestUp = upFiles[upFiles.length - 1];
if (!latestUp) {
	console.error('No migration file was created.');
	process.exit(1);
}

const baseName = latestUp.split('/').pop().replace('.sql', '');
const downPath = join(downDir, `${baseName}.down.sql`);

if (existsSync(downPath)) {
	console.log(`Down migration already exists: ${downPath}`);
	process.exit(0);
}

writeFileSync(
	downPath,
	`-- Rollback: ${baseName}\n-- TODO: write reverse SQL for this migration\n`,
	'utf8',
);

console.log(`Created down migration: ${downPath}`);
console.log('Remember to implement both up and down SQL before applying.');
