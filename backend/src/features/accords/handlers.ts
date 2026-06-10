import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { conflict, serverError } from '../../lib/http';
import { createAccord, listAccords } from './repo';
import { createAccordSchema } from './schema';

export const accordRoutes = new Hono<{ Bindings: Env }>()
	.get('/', async (c) => {
		const accords = await listAccords(c.env.DB);
		return c.json({ accords });
	})
	.post('/', zValidator('json', createAccordSchema), async (c) => {
		const input = c.req.valid('json');
		try {
			const accord = await createAccord(c.env.DB, input);
			return c.json({ accord }, 201);
		} catch (error) {
			if (error instanceof Error && error.message.includes('UNIQUE')) {
				return conflict(c, 'Accord slug already exists');
			}
			return serverError(c);
		}
	});
