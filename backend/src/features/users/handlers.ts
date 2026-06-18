import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { type AuthContext, supabaseAuth } from '../../lib/auth';
import { badRequest, conflict, notFound, serverError } from '../../lib/http';
import { createUser, getUserById, getUserByUsername, syncEmail, updateProfile } from './repo';
import { ensureUserSchema, updateProfileSchema, usernameSchema } from './schema';

function isUniqueViolation(error: unknown): boolean {
	return error instanceof Error && error.message.includes('UNIQUE');
}

/**
 * Best-effort username when the client didn't supply one (e.g. a returning
 * user logging in): prefer the Supabase user_metadata.username, fall back to
 * the email local part. Returns null when nothing valid can be derived.
 */
function deriveUsername(metadata: Record<string, unknown>, email: string | null): string | null {
	const candidates = [metadata.username, metadata.user_name, email ? email.split('@')[0] : undefined];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const cleaned = candidate.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
		const parsed = usernameSchema.safeParse(cleaned);
		if (parsed.success) return parsed.data;
	}
	return null;
}

/** Routes for the authenticated current user. Mounted at `/me`. */
export const meRoutes = new Hono<AuthContext>()
	.use('*', supabaseAuth)
	.get('/', async (c) => {
		const auth = c.get('user');
		const user = await getUserById(c.env.DB, auth.id);
		if (!user) return notFound(c, 'User not registered');
		return c.json({ user });
	})
	.post('/', zValidator('json', ensureUserSchema), async (c) => {
		const auth = c.get('user');
		const { username: bodyUsername } = c.req.valid('json');

		const existing = await getUserById(c.env.DB, auth.id);
		if (existing) {
			if (auth.email) await syncEmail(c.env.DB, auth.id, auth.email);
			const user = (await getUserById(c.env.DB, auth.id)) ?? existing;
			return c.json({ user });
		}

		const username = bodyUsername ?? deriveUsername(auth.metadata, auth.email);
		if (!username) return badRequest(c, 'A username is required to create your profile');
		if (!auth.email) return badRequest(c, 'Account is missing an email address');

		try {
			const user = await createUser(c.env.DB, { id: auth.id, username, email: auth.email });
			return c.json({ user }, 201);
		} catch (error) {
			if (isUniqueViolation(error)) return conflict(c, 'That username is already taken');
			return serverError(c);
		}
	})
	.patch('/', zValidator('json', updateProfileSchema), async (c) => {
		const auth = c.get('user');
		const { username } = c.req.valid('json');

		const existing = await getUserById(c.env.DB, auth.id);
		if (!existing) return notFound(c, 'User not registered');

		try {
			const user = await updateProfile(c.env.DB, auth.id, { username });
			return c.json({ user });
		} catch (error) {
			if (isUniqueViolation(error)) return conflict(c, 'That username is already taken');
			return serverError(c);
		}
	});

/** Public profile lookup by username. Mounted at `/users`. */
export const userPublicRoutes = new Hono<{ Bindings: Env }>().get('/:username', async (c) => {
	const user = await getUserByUsername(c.env.DB, c.req.param('username').toLowerCase());
	if (!user) return notFound(c, 'User not found');
	// Only expose non-sensitive fields publicly.
	return c.json({ user: { id: user.id, username: user.username, created_at: user.created_at } });
});
