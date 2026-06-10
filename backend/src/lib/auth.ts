import type { Context, Next } from 'hono';

export async function apiKeyAuth(c: Context<{ Bindings: Env }>, next: Next) {
	const expected = c.env.ADMIN_API_KEY ?? 'dev-admin-key';
	const provided = c.req.header('x-api-key');

	if (!provided || provided !== expected) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	await next();
}
