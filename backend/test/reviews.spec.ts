import { env, SELF } from 'cloudflare:test';
import { SignJWT } from 'jose';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations } from './applyMigrations';

const PRODUCT_ID = 'prod-feudebois';
const PRODUCT_SLUG = 'feu-de-bois';
const ADMIN_KEY = env.ADMIN_API_KEY ?? 'dev-admin-key';

type Review = { id: string; status: string; rating: number | null; body: string; user_id: string | null };

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

function adminGet(path: string) {
	return SELF.fetch(`https://example.com${path}`, { headers: { 'x-api-key': ADMIN_KEY } });
}
function adminPost(path: string, body: unknown = {}) {
	return SELF.fetch(`https://example.com${path}`, {
		method: 'POST',
		headers: { 'x-api-key': ADMIN_KEY, 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function register(token: string, username: string) {
	await SELF.fetch('https://example.com/me', authed(token, { username }));
}

async function productReviews(): Promise<{ body: string }[]> {
	const res = await SELF.fetch(`https://example.com/products/${PRODUCT_SLUG}`);
	return (await res.json<{ reviews: { body: string }[] }>()).reviews;
}

describe('reviews + moderation', () => {
	beforeAll(async () => {
		await applyMigrations(env.DB);
	});

	it('requires auth to submit', async () => {
		const res = await SELF.fetch(
			`https://example.com/products/${PRODUCT_ID}/reviews`,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: 5, body: 'x' }) },
		);
		expect(res.status).toBe(401);
	});

	it('validates rating + body', async () => {
		const token = await mintToken('rev-val');
		await register(token, 'rev_val');
		const noBody = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/reviews`, authed(token, { rating: 5 }));
		expect(noBody.status).toBe(400);
		const badRating = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/reviews`, authed(token, { rating: 9, body: 'hi' }));
		expect(badRating.status).toBe(400);
	});

	it('submits a pending review hidden from the product until approved', async () => {
		const token = await mintToken('rev-1');
		await register(token, 'rev_one');

		const res = await SELF.fetch(
			`https://example.com/products/${PRODUCT_ID}/reviews`,
			authed(token, { rating: 4, title: 'Cosy', body: 'Warm and woody.' }),
		);
		expect(res.status).toBe(201);
		const body = await res.json<{ review: Review; status: string }>();
		expect(body.status).toBe('pending');
		expect(body.review.status).toBe('pending');
		expect(body.review.user_id).toBe('rev-1');

		// Not visible publicly yet.
		expect(await productReviews()).toHaveLength(0);

		// Visible in the admin pending queue with author/product joins.
		const queue = await adminGet('/admin/reviews?status=pending');
		expect(queue.status).toBe(200);
		const data = await queue.json<{ reviews: Array<Review & { user_username: string; product_slug: string }>; counts: { pending: number } }>();
		const mine = data.reviews.find((r) => r.id === body.review.id);
		expect(mine?.user_username).toBe('rev_one');
		expect(mine?.product_slug).toBe(PRODUCT_SLUG);
		expect(data.counts.pending).toBeGreaterThanOrEqual(1);

		// Approve -> now public.
		const approve = await adminPost(`/admin/reviews/${body.review.id}/approve`);
		expect(approve.status).toBe(200);
		const pub = await productReviews();
		expect(pub.some((r) => r.body === 'Warm and woody.')).toBe(true);
	});

	it('re-submitting replaces the review and resets it to pending (one per product)', async () => {
		const token = await mintToken('rev-2');
		await register(token, 'rev_two');

		const first = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/reviews`, authed(token, { rating: 5, body: 'first take' }));
		const firstId = (await first.json<{ review: Review }>()).review.id;
		await adminPost(`/admin/reviews/${firstId}/approve`);

		const second = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/reviews`, authed(token, { rating: 2, body: 'changed my mind' }));
		const secondReview = (await second.json<{ review: Review }>()).review;
		expect(secondReview.id).toBe(firstId); // same row
		expect(secondReview.status).toBe('pending'); // back to pending

		// Only one row for this user+product.
		const profile = await adminGet('/admin/reviews/user/rev-2');
		const data = await profile.json<{ stats: { total: number }; reviews: Review[] }>();
		expect(data.stats.total).toBe(1);
		expect(data.reviews[0]?.body).toBe('changed my mind');
	});

	it('rejecting hides a previously-approved review', async () => {
		const token = await mintToken('rev-3');
		await register(token, 'rev_three');
		const res = await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/reviews`, authed(token, { rating: 3, body: 'rejectable' }));
		const id = (await res.json<{ review: Review }>()).review.id;
		await adminPost(`/admin/reviews/${id}/approve`);
		expect((await productReviews()).some((r) => r.body === 'rejectable')).toBe(true);

		const reject = await adminPost(`/admin/reviews/${id}/reject`, { note: 'spam' });
		expect(reject.status).toBe(200);
		expect((await productReviews()).some((r) => r.body === 'rejectable')).toBe(false);
	});

	it('admin user profile returns metadata + stats', async () => {
		const token = await mintToken('rev-4');
		await register(token, 'rev_four');
		await SELF.fetch(`https://example.com/products/${PRODUCT_ID}/reviews`, authed(token, { rating: 5, body: 'profile test' }));

		const res = await adminGet('/admin/reviews/user/rev-4');
		expect(res.status).toBe(200);
		const data = await res.json<{ user: { username: string; email: string }; stats: { pending: number; total: number } }>();
		expect(data.user.username).toBe('rev_four');
		expect(data.stats.pending).toBe(1);
		expect(data.stats.total).toBe(1);
	});
});
