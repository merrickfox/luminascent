import type { Context, Next } from 'hono';
import { jwtVerify } from 'jose';

export async function apiKeyAuth(c: Context<{ Bindings: Env }>, next: Next) {
	const expected = c.env.ADMIN_API_KEY ?? 'dev-admin-key';
	const provided = c.req.header('x-api-key');

	if (!provided || provided !== expected) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	await next();
}

/**
 * The authenticated user resolved from a verified Supabase JWT.
 * `id` is the Supabase user id (the token's `sub` claim) — we use it verbatim
 * as our own user id so the two systems correlate.
 */
export type AuthUser = {
	id: string;
	email: string | null;
	metadata: Record<string, unknown>;
};

/** Hono context type for routes that expect a resolved `user` variable. */
export type AuthContext = { Bindings: Env; Variables: { user: AuthUser } };

/**
 * Verify a Supabase-issued access token using the legacy (symmetric, HS256)
 * JWT secret. Verification is fully local — no network call to Supabase.
 * Returns the resolved user, or null if the token is missing/invalid.
 */
async function verifyBearer(c: Context<AuthContext>): Promise<AuthUser | null> {
	const header = c.req.header('Authorization') ?? c.req.header('authorization');
	if (!header?.startsWith('Bearer ')) return null;
	const token = header.slice('Bearer '.length).trim();
	if (!token) return null;

	const secret = c.env.SUPABASE_JWT_SECRET;
	if (!secret) {
		console.error('[auth] SUPABASE_JWT_SECRET is not configured');
		return null;
	}

	try {
		const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
			algorithms: ['HS256'],
		});
		// Supabase signs end-user tokens with the `authenticated` audience.
		if (payload.aud !== 'authenticated') return null;
		if (typeof payload.sub !== 'string' || !payload.sub) return null;

		return {
			id: payload.sub,
			email: typeof payload.email === 'string' ? payload.email : null,
			metadata:
				payload.user_metadata && typeof payload.user_metadata === 'object'
					? (payload.user_metadata as Record<string, unknown>)
					: {},
		};
	} catch {
		return null;
	}
}

/** Require a valid Supabase JWT. Sets `c.get('user')` or returns 401. */
export async function supabaseAuth(c: Context<AuthContext>, next: Next) {
	const user = await verifyBearer(c);
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	c.set('user', user);
	await next();
}

/**
 * Resolve a Supabase JWT if present, but do not require it. Sets `c.get('user')`
 * when a valid token is provided; otherwise leaves it undefined and continues.
 */
export async function optionalSupabaseAuth(c: Context<AuthContext>, next: Next) {
	const user = await verifyBearer(c);
	if (user) c.set('user', user);
	await next();
}
