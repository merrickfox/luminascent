/**
 * Central user registry row. `id` is the Supabase user id (JWT `sub`) so our
 * registry and Supabase Auth share a key. Mirrors the `users` D1 table.
 */
export type User = {
	id: string;
	username: string;
	email: string;
	created_at: string;
	updated_at: string;
};
