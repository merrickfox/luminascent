import { env, SELF } from 'cloudflare:test';
import { SignJWT } from 'jose';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations } from './applyMigrations';

// product 'prod-feudebois' (slug feu-de-bois) is seeded by applyMigrations.
const PRODUCT_ID = 'prod-feudebois';

type Vote = { dimension_slug: string; option_slug: string; option_label: string; vote_count: number };
type VoteResponse = { votes: Vote[]; my_votes: { dimension_slug: string; option_slug: string }[] };

async function mintToken(sub: string): Promise<string> {
	return new SignJWT({ aud: 'authenticated', role: 'authenticated', email: `${sub}@example.com` })
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(sub)
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(new TextEncoder().encode(env.SUPABASE_JWT_SECRET));
}

function authed(token: string, body?: unknown, method = 'POST') {
	return {
		method,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	};
}

/** Register the user (votes FK to users) the way the frontend does on login. */
async function register(token: string, username: string) {
	await SELF.fetch('https://example.com/me', authed(token, { username }));
}

describe('community votes', () => {
	beforeAll(async () => {
		await applyMigrations(env.DB);
	});

	it('requires auth to vote', async () => {
		const res = await SELF.fetch(
			`https://example.com/products/${PRODUCT_ID}/vote`,
			authed('', { dimension_slug: 'sillage', option_slug: 'strong' }),
		);
		// no/invalid token -> 401 (authed() with '' sends "Bearer ")
		expect(res.status).toBe(401);
	});

	it('exposes the votable dimension catalog', async () => {
		const res = await SELF.fetch('https://example.com/vote-dimensions');
		expect(res.status).toBe(200);
		const body = await res.json<{ dimensions: { slug: string; options: unknown[] }[] }>();
		const sillage = body.dimensions.find((d) => d.slug === 'sillage');
		expect(sillage?.options.length).toBe(4); // intimate, moderate, strong, enormous
	});

	it('casts, changes (within a dimension), and reflects real-only counts', async () => {
		const token = await mintToken('voter-1');
		await register(token, 'voter_one');

		// Cast: sillage -> strong
		const cast = await SELF.fetch(
			`https://example.com/products/${PRODUCT_ID}/vote`,
			authed(token, { dimension_slug: 'sillage', option_slug: 'strong' }),
		);
		expect(cast.status).toBe(200);
		let body = await cast.json<VoteResponse>();
		expect(body.my_votes).toContainEqual({ dimension_slug: 'sillage', option_slug: 'strong' });
		const strong = body.votes.find((v) => v.dimension_slug === 'sillage' && v.option_slug === 'strong');
		expect(strong?.vote_count).toBe(1);
		// Real-only: seeded aggregates (winter/love/etc.) are NOT counted.
		expect(body.votes.some((v) => v.dimension_slug === 'season')).toBe(false);

		// Change within the same dimension: strong -> intimate (no duplicate row).
		const change = await SELF.fetch(
			`https://example.com/products/${PRODUCT_ID}/vote`,
			authed(token, { dimension_slug: 'sillage', option_slug: 'intimate' }),
		);
		body = await change.json<VoteResponse>();
		const sillageVotes = body.votes.filter((v) => v.dimension_slug === 'sillage');
		expect(sillageVotes.reduce((n, v) => n + v.vote_count, 0)).toBe(1);
		expect(body.my_votes).toContainEqual({ dimension_slug: 'sillage', option_slug: 'intimate' });
	});

	it('aggregates votes from multiple users', async () => {
		const a = await mintToken('multi-a');
		const b = await mintToken('multi-b');
		await register(a, 'multi_a');
		await register(b, 'multi_b');

		await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/vote`, authed(a, { dimension_slug: 'longevity', option_slug: 'long_lasting' }));
		const res = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/vote`, authed(b, { dimension_slug: 'longevity', option_slug: 'long_lasting' }));
		const body = await res.json<VoteResponse>();
		const opt = body.votes.find((v) => v.dimension_slug === 'longevity' && v.option_slug === 'long_lasting');
		expect(opt?.vote_count).toBe(2);
	});

	it('GET /my-votes returns the user picks; DELETE removes a vote', async () => {
		const token = await mintToken('voter-3');
		await register(token, 'voter_three');
		await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/vote`, authed(token, { dimension_slug: 'gender', option_slug: 'unisex' }));

		const mine = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/my-votes`, { headers: { authorization: `Bearer ${token}` } });
		expect(mine.status).toBe(200);
		expect((await mine.json<{ my_votes: unknown[] }>()).my_votes).toContainEqual({ dimension_slug: 'gender', option_slug: 'unisex' });

		const removed = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/vote`, authed(token, { dimension_slug: 'gender' }, 'DELETE'));
		const body = await removed.json<VoteResponse>();
		expect(body.my_votes.some((v) => v.dimension_slug === 'gender')).toBe(false);
		expect(body.votes.some((v) => v.dimension_slug === 'gender')).toBe(false);
	});

	it('rejects an unknown option', async () => {
		const token = await mintToken('voter-4');
		await register(token, 'voter_four');
		const res = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/vote`, authed(token, { dimension_slug: 'sillage', option_slug: 'nope' }));
		expect(res.status).toBe(400);
	});

	it('404s for an unknown product', async () => {
		const token = await mintToken('voter-5');
		await register(token, 'voter_five');
		const res = await SELF.fetch(`https://example.com/products/does-not-exist/vote`, authed(token, { dimension_slug: 'sillage', option_slug: 'strong' }));
		expect(res.status).toBe(404);
	});
});
