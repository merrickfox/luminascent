import type { UserStore } from '../durable-objects/UserStore';

/**
 * Resolve the per-user Durable Object stub for a given user id. The DO is
 * addressed deterministically by the Supabase user id, so the same user always
 * maps to the same instance.
 */
export function getUserStore(env: Env, userId: string): DurableObjectStub<UserStore> {
	return env.USER_STORE.get(env.USER_STORE.idFromName(userId));
}
