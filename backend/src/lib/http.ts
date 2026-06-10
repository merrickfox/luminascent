import type { Context } from 'hono';

export function notFound(c: Context, message = 'Not found') {
	return c.json({ error: message }, 404);
}

export function badRequest(c: Context, message: string) {
	return c.json({ error: message }, 400);
}

export function conflict(c: Context, message: string) {
	return c.json({ error: message }, 409);
}

export function serverError(c: Context, message = 'Internal server error') {
	return c.json({ error: message }, 500);
}
