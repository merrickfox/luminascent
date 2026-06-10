import { z } from 'zod';

export const createNoteSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1).optional(),
	note_family: z.string().optional(),
});
