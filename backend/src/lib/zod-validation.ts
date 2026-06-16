import type { Context } from 'hono';
import type { ZodError } from 'zod';

export function formatZodError(error: ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
			return `${path}: ${issue.message}`;
		})
		.join('; ');
}

export function validationFailed(c: Context, error: ZodError) {
	const message = formatZodError(error);
	console.error(`[validation] ${c.req.method} ${c.req.path}: ${message}`);
	return c.json({ error: message, issues: error.issues }, 400);
}
