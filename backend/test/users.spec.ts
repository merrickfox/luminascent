import { env, SELF } from 'cloudflare:test';
import { SignJWT } from 'jose';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations } from './applyMigrations';

// NOTE: vitest-pool-workers isolates storage per test (writes roll back between
// `it` blocks), so each test below is self-contained rather than relying on
// state created by an earlier test.

type UserResponse = { user: { id: string; username: string; email: string } };

async function mintToken(opts: {
	sub: string;
	email?: string | null;
	metadata?: Record<string, unknown>;
	aud?: string;
	secret?: string;
}): Promise<string> {
	const secret = opts.secret ?? env.SUPABASE_JWT_SECRET;
	const payload: Record<string, unknown> = {
		aud: opts.aud ?? 'authenticated',
		role: 'authenticated',
		user_metadata: opts.metadata ?? {},
	};
	if (opts.email !== undefined) payload.email = opts.email;
	return new SignJWT(payload)
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(opts.sub)
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(new TextEncoder().encode(secret));
}

function authed(token: string, body?: unknown, method = 'POST') {
	return {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	};
}

describe('users + auth', () => {
	beforeAll(async () => {
		await applyMigrations(env.DB);
	});

	it('rejects /me with no token', async () => {
		const res = await SELF.fetch('https://example.com/me');
		expect(res.status).toBe(401);
	});

	it('rejects an invalid token', async () => {
		const res = await SELF.fetch('https://example.com/me', {
			headers: { authorization: 'Bearer not-a-real-jwt' },
		});
		expect(res.status).toBe(401);
	});

	it('rejects a token signed with the wrong secret', async () => {
		const token = await mintToken({ sub: 'wrong-secret-user', email: 'x@y.com', secret: 'totally-wrong-secret' });
		const res = await SELF.fetch('https://example.com/me', { headers: { authorization: `Bearer ${token}` } });
		expect(res.status).toBe(401);
	});

	it('GET /me returns 404 before registration', async () => {
		const token = await mintToken({ sub: 'unregistered-user', email: 'nobody@example.com' });
		const res = await SELF.fetch('https://example.com/me', { headers: { authorization: `Bearer ${token}` } });
		expect(res.status).toBe(404);
	});

	it('full lifecycle: create, idempotent login, get, update', async () => {
		const token = await mintToken({ sub: 'sup-user-1', email: 'ada@example.com' });

		// First POST /me creates the row (username lowercased).
		const created = await SELF.fetch('https://example.com/me', authed(token, { username: 'AdaLovelace' }));
		expect(created.status).toBe(201);
		expect((await created.json<UserResponse>()).user).toMatchObject({
			id: 'sup-user-1',
			username: 'adalovelace',
			email: 'ada@example.com',
		});

		// Second POST (login) is idempotent: 200, no rename.
		const again = await SELF.fetch('https://example.com/me', authed(token, {}));
		expect(again.status).toBe(200);
		expect((await again.json<UserResponse>()).user.username).toBe('adalovelace');

		// GET /me reflects the row.
		const got = await SELF.fetch('https://example.com/me', { headers: { authorization: `Bearer ${token}` } });
		expect(got.status).toBe(200);

		// PATCH updates the username.
		const patched = await SELF.fetch('https://example.com/me', authed(token, { username: 'ada_l' }, 'PATCH'));
		expect(patched.status).toBe(200);
		expect((await patched.json<UserResponse>()).user.username).toBe('ada_l');
	});

	it('rejects a duplicate username with 409', async () => {
		const tokenA = await mintToken({ sub: 'dup-a', email: 'a@example.com' });
		const tokenB = await mintToken({ sub: 'dup-b', email: 'b@example.com' });

		const a = await SELF.fetch('https://example.com/me', authed(tokenA, { username: 'samename' }));
		expect(a.status).toBe(201);

		const b = await SELF.fetch('https://example.com/me', authed(tokenB, { username: 'samename' }));
		expect(b.status).toBe(409);
	});

	it('derives a username from metadata when none is provided', async () => {
		const token = await mintToken({ sub: 'sup-user-3', email: 'linus@example.com', metadata: { username: 'Torvalds' } });
		const res = await SELF.fetch('https://example.com/me', authed(token, {}));
		expect(res.status).toBe(201);
		expect((await res.json<UserResponse>()).user.username).toBe('torvalds');
	});

	it('exposes a public profile by username without the email', async () => {
		const token = await mintToken({ sub: 'public-user', email: 'pub@example.com' });
		await SELF.fetch('https://example.com/me', authed(token, { username: 'publicname' }));

		const res = await SELF.fetch('https://example.com/users/publicname');
		expect(res.status).toBe(200);
		const body = await res.json<{ user: { id: string; username: string; email?: string } }>();
		expect(body.user.username).toBe('publicname');
		expect(body.user.email).toBeUndefined();
	});

	it('per-user Durable Object responds and starts empty', async () => {
		const stub = env.USER_STORE.get(env.USER_STORE.idFromName('sup-user-1'));
		expect(await stub.ping()).toEqual({ ok: true });
		expect(await stub.getFavourites()).toEqual([]);
	});
});
