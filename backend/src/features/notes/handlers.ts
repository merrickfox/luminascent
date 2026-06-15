import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { conflict, notFound, serverError } from '../../lib/http';
import { createNote, getNoteById, listNotes, updateNoteColor } from './repo';
import { createNoteSchema, updateNoteColorSchema } from './schema';

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
	})
	.patch('/:id', zValidator('json', updateNoteColorSchema), async (c) => {
		const id = c.req.param('id');
		const existing = await getNoteById(c.env.DB, id);
		if (!existing) return notFound(c, 'Note not found');

		const input = c.req.valid('json');
		const note = await updateNoteColor(c.env.DB, id, input);
		return c.json({ note });
	});
