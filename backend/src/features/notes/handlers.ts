import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { conflict, serverError } from '../../lib/http';
import { createNote, listNotes } from './repo';
import { createNoteSchema } from './schema';

export const noteRoutes = new Hono<{ Bindings: Env }>()
	.get('/', async (c) => {
		const notes = await listNotes(c.env.DB);
		return c.json({ notes });
	})
	.post('/', zValidator('json', createNoteSchema), async (c) => {
		const input = c.req.valid('json');
		try {
			const note = await createNote(c.env.DB, input);
			return c.json({ note }, 201);
		} catch (error) {
			if (error instanceof Error && error.message.includes('UNIQUE')) {
				return conflict(c, 'Note slug already exists');
			}
			return serverError(c);
		}
	});
