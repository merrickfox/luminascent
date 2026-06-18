import type { Context, Next } from 'hono';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

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

// Cache the JWKS key set per project URL across requests in this isolate. jose
// caches the fetched keys internally and only refetches on an unknown `kid` or
// after its cooldown, so verification does not hit the network per request.
let jwksKeySet: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksForUrl: string | null = null;

function getJwks(supabaseUrl: string) {
	const jwksUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
	if (!jwksKeySet || jwksForUrl !== jwksUrl) {
		jwksKeySet = createRemoteJWKSet(new URL(jwksUrl));
		jwksForUrl = jwksUrl;
	}
	return jwksKeySet;
}

/**
 * Verify a Supabase-issued access token. Supabase now signs end-user tokens
 * with asymmetric keys (ES256/RS256), verified against the project's JWKS and
 * pinned to the project issuer. Legacy symmetric HS256 tokens (used by the test
 * suite) are verified with `SUPABASE_JWT_SECRET`.
 * Returns the resolved user, or null if the token is missing/invalid.
 */
async function verifyBearer(c: Context<AuthContext>): Promise<AuthUser | null> {
	const header = c.req.header('Authorization') ?? c.req.header('authorization');
	if (!header?.startsWith('Bearer ')) return null;
	const token = header.slice('Bearer '.length).trim();
	if (!token) return null;

	let payload: JWTPayload;
	try {
		const { alg } = decodeProtectedHeader(token);

		if (alg === 'HS256') {
			const secret = c.env.SUPABASE_JWT_SECRET;
			if (!secret) {
				console.error('[auth] SUPABASE_JWT_SECRET is not configured');
				return null;
			}
			({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] }));
		} else {
			const supabaseUrl = c.env.SUPABASE_URL;
			if (!supabaseUrl) {
				console.error('[auth] SUPABASE_URL is not configured');
				return null;
			}
			({ payload } = await jwtVerify(token, getJwks(supabaseUrl), {
				algorithms: ['ES256', 'RS256'],
				issuer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
			}));
		}
	} catch {
		return null;
	}

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
