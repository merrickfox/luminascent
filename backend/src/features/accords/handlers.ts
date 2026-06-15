import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { conflict, notFound, serverError } from '../../lib/http';
import { createAccord, getAccordById, listAccords, updateAccordColor } from './repo';
import { createAccordSchema, updateAccordColorSchema } from './schema';

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
	})
	.patch('/:id', zValidator('json', updateAccordColorSchema), async (c) => {
		const id = c.req.param('id');
		const existing = await getAccordById(c.env.DB, id);
		if (!existing) return notFound(c, 'Accord not found');

		const input = c.req.valid('json');
		const accord = await updateAccordColor(c.env.DB, id, input);
		return c.json({ accord });
	});
